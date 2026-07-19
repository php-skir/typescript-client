import { encode } from "cbor-x";
import { describe, it } from "mocha";
import assert from "node:assert/strict";
import * as skir from "./skir-client.js";

const squareMethod: skir.Method<number, number> = {
  name: "Square",
  number: 1001,
  requestSerializer: skir.primitiveSerializer("int32"),
  responseSerializer: skir.primitiveSerializer("int32"),
  doc: "Squares a number.",
};

const echoMethod: skir.Method<string, string> = {
  name: "Echo",
  number: 1002,
  requestSerializer: skir.primitiveSerializer("string"),
  responseSerializer: skir.primitiveSerializer("string"),
  doc: "Echoes text.",
};

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error);
    return error;
  }
  throw new Error("Expected action to throw");
}

async function withFetch(
  replacement: typeof fetch,
  action: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("ServiceClient legacy transport", () => {
  it("rejects service URLs containing a query string", () => {
    assert.throws(
      () => new skir.ServiceClient("https://example.com/rpc?tenant=1"),
      /Service URL must not contain a query string/,
    );
  });

  it("sends metadata and the legacy envelope in a POST request", async () => {
    await withFetch(
      async (input, init): Promise<Response> => {
        assert.equal(input.toString(), "https://example.com/rpc");
        assert.equal(init?.method, "POST");
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer x",
        );
        assert.equal(init?.body, "Square:1001::7");
        return new Response("49", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async (): Promise<void> => {
        const client = new skir.ServiceClient(
          "https://example.com/rpc",
          async (method): Promise<skir.RequestMeta> => {
            assert.equal(method, squareMethod);
            return { headers: { Authorization: "Bearer x" } };
          },
        );
        assert.equal(await client.invokeRemote(squareMethod, 7), 49);
      },
    );
  });

  it("puts the escaped legacy envelope in the GET query string", async () => {
    const request = "100% ready? yes & no";
    await withFetch(
      async (input, init): Promise<Response> => {
        const url = new URL(input.toString());
        assert.match(url.search, /%25/);
        assert.equal(
          decodeURIComponent(url.search.slice(1)),
          `Echo:1002::${JSON.stringify(request)}`,
        );
        assert.equal(init?.method, "GET");
        assert.equal(init?.body, undefined);
        return new Response(JSON.stringify(request), { status: 200 });
      },
      async (): Promise<void> => {
        const client = new skir.ServiceClient("https://example.com/rpc");
        assert.equal(
          await client.invokeRemote(echoMethod, request, "GET"),
          request,
        );
      },
    );
  });

  it("includes plain-text error bodies in HTTP errors", async () => {
    await withFetch(
      async (): Promise<Response> =>
        new Response("rate limited", {
          status: 429,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      async (): Promise<void> => {
        const client = new skir.ServiceClient("https://example.com/rpc");
        const error = await captureError(() =>
          client.invokeRemote(squareMethod, 7),
        );
        assert.equal(error.message, "HTTP status 429: rate limited");
      },
    );
  });

  it("does not expose non-plain HTTP error bodies", async () => {
    await withFetch(
      async (): Promise<Response> =>
        new Response('{"secret":"details"}', {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      async (): Promise<void> => {
        const client = new skir.ServiceClient("https://example.com/rpc");
        const error = await captureError(() =>
          client.invokeRemote(squareMethod, 7),
        );
        assert.equal(error.message, "HTTP status 500");
      },
    );
  });
});

describe("ServiceClient CBOR validation", () => {
  it("rejects GET requests before calling fetch", async () => {
    let fetchCalled = false;
    await withFetch(
      async (): Promise<Response> => {
        fetchCalled = true;
        return new Response();
      },
      async (): Promise<void> => {
        const client = new skir.ServiceClient(
          "https://example.com/rpc",
          undefined,
          { transportCodec: "cbor" },
        );
        const error = await captureError(() =>
          client.invokeRemote(squareMethod, 7, "GET"),
        );
        assert.equal(
          error.message,
          "CBOR transport only supports POST requests",
        );
        assert.equal(fetchCalled, false);
      },
    );
  });
});

describe("Service discovery", () => {
  it("lists method numbers and descriptors", async () => {
    const service = new skir.Service<unknown>();
    service.addMethod(
      squareMethod,
      async (request): Promise<number> => request,
    );

    const response = await service.handleRequest("list", {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.contentType, "application/json");
    assert.deepEqual(JSON.parse(response.data as string), {
      methods: [
        {
          method: "Square",
          number: 1001,
          request: {
            type: { kind: "primitive", value: "int32" },
            records: [],
          },
          response: {
            type: { kind: "primitive", value: "int32" },
            records: [],
          },
          doc: "Squares a number.",
        },
      ],
    });
  });

  it("serves Studio for the empty and studio query bodies", async () => {
    const service = new skir.Service<unknown>({
      studioAppJsUrl: "https://assets.example.com/studio.js",
    });
    for (const request of ["", "studio"]) {
      const response = await service.handleRequest(request, {});
      assert.equal(response.statusCode, 200);
      assert.equal(response.contentType, "text/html; charset=utf-8");
      assert.match(response.data as string, /<title>RPC Studio<\/title>/);
      assert.match(
        response.data as string,
        /https:\/\/assets\.example\.com\/studio\.js/,
      );
    }
  });

  it("rejects duplicate method numbers", () => {
    const service = new skir.Service<unknown>();
    service.addMethod(
      squareMethod,
      async (request): Promise<number> => request,
    );
    assert.throws(
      () =>
        service.addMethod(
          { ...squareMethod, name: "OtherSquare" },
          async (request): Promise<number> => request,
        ),
      /Method with the same number already registered \(1001\)/,
    );
  });
});

describe("Service request validation", () => {
  it("rejects malformed CBOR envelopes with precise bad-request responses", async () => {
    const service = new skir.Service<unknown>({ transportCodec: "cbor" });
    const requests: Array<[skir.RawRequestBody, string]> = [
      ["not-cbor", "bad request: invalid CBOR"],
      [new Uint8Array([0x1a]), "bad request: invalid CBOR"],
      [encode(["not", "a", "map"]), "bad request: CBOR body must be a map"],
      [encode({ request: 7 }), "bad request: missing 'method' field in CBOR"],
      [
        encode({ method: true, request: 7 }),
        "bad request: 'method' field must be a string or a number",
      ],
      [
        encode({ method: "Square" }),
        "bad request: missing 'request' field in CBOR",
      ],
    ];
    for (const [body, message] of requests) {
      const response = await service.handleRequest(body, {});
      assert.equal(response.statusCode, 400);
      assert.equal(response.data, message);
    }
  });

  it("accepts legacy JSON requests by method name and number", async () => {
    const service = new skir.Service<unknown>();
    service.addMethod(
      squareMethod,
      async (request): Promise<number> => request * request,
    );

    for (const body of [
      JSON.stringify({ method: "Square", request: 6 }),
      JSON.stringify({ method: 1001, request: 7 }),
    ]) {
      const response = await service.handleRequest(body, {});
      assert.equal(response.statusCode, 200);
    }
  });

  it("rejects malformed legacy request envelopes", async () => {
    const service = new skir.Service<unknown>();
    const requests: Array<[skir.RawRequestBody, string]> = [
      [new Uint8Array(), "bad request: invalid request format"],
      ["{", "bad request: invalid JSON"],
      [" null", "bad request: invalid request format"],
      [" []", "bad request: invalid request format"],
      [" 7", "bad request: invalid request format"],
      ["{}", "bad request: missing 'method' field in JSON"],
      [
        JSON.stringify({ method: true, request: 1 }),
        "bad request: 'method' field must be a string or a number",
      ],
      [
        JSON.stringify({ method: "Square" }),
        "bad request: missing 'request' field in JSON",
      ],
      ["not-an-envelope", "bad request: invalid request format"],
      ["Square:nope::7", "bad request: can't parse method number"],
    ];
    for (const [body, message] of requests) {
      const response = await service.handleRequest(body, {});
      assert.equal(response.statusCode, 400);
      assert.equal(response.data, message);
    }
  });

  it("distinguishes missing and ambiguous method lookups", async () => {
    const service = new skir.Service<unknown>();
    service
      .addMethod(squareMethod, async (request): Promise<number> => request)
      .addMethod(
        { ...squareMethod, number: 1002 },
        async (request): Promise<number> => request,
      );

    let response = await service.handleRequest("Missing:::1", {});
    assert.equal(response.data, "bad request: method not found: Missing");

    response = await service.handleRequest("Square:::1", {});
    assert.equal(
      response.data,
      "bad request: method name 'Square' is ambiguous; use method number instead",
    );

    response = await service.handleRequest("Square:9999::1", {});
    assert.equal(
      response.data,
      "bad request: method not found: Square; number: 9999",
    );
  });

  it("returns a bad request when the request serializer rejects JSON", async () => {
    const service = new skir.Service<unknown>();
    service.addMethod(
      squareMethod,
      async (request): Promise<number> => request,
    );
    const response = await service.handleRequest("Square:1001::{", {});
    assert.equal(response.statusCode, 400);
    assert.match(response.data as string, /^bad request: can't parse JSON:/);
  });
});

describe("Service method execution", () => {
  it("passes transformed metadata to implementations", async () => {
    const service = new skir.Service<{ userId: number }>();
    service.addMethod(
      squareMethod,
      async (request, metadata): Promise<number> => {
        return request + metadata.userId;
      },
    );
    const handler = service.withMetaTransformer(
      (metadata: { auth: string }): { userId: number } => ({
        userId: Number(metadata.auth),
      }),
    );
    const response = await handler.handleRequest("Square:1001::7", {
      auth: "5",
    });
    assert.equal(response.data, "12");
  });

  it("returns ServiceError status and message while logging context", async () => {
    const logged: unknown[] = [];
    const service = new skir.Service<{ userId: number }>({
      errorLogger: (errorInfo): void => {
        logged.push(errorInfo);
      },
    });
    service.addMethod(squareMethod, async (): Promise<number> => {
      throw new skir.ServiceError({
        statusCode: 403,
        desc: "Forbidden",
        message: "account disabled",
      });
    });
    const response = await service.handleRequest("Square:1001::7", {
      userId: 42,
    });
    assert.deepEqual(
      { statusCode: response.statusCode, data: response.data },
      { statusCode: 403, data: "account disabled" },
    );
    assert.equal(logged.length, 1);
    assert.equal((logged[0] as { request: number }).request, 7);
    assert.deepEqual((logged[0] as { reqMeta: unknown }).reqMeta, {
      userId: 42,
    });
  });

  it("masks unknown errors by default and can expose selected errors", async () => {
    for (const [canSend, expected] of [
      [false, "server error"],
      [true, "server error: Error: sensitive detail"],
      [(): boolean => true, "server error: Error: sensitive detail"],
    ] as const) {
      const service = new skir.Service<unknown>({
        canSendUnknownErrorMessage: canSend,
        errorLogger: (): void => {},
      });
      service.addMethod(squareMethod, async (): Promise<number> => {
        throw new Error("sensitive detail");
      });
      const response = await service.handleRequest("Square:1001::7", {});
      assert.equal(response.statusCode, 500);
      assert.equal(response.data, expected);
    }
  });

  it("logs metadata-transform failures without fabricated request metadata", async () => {
    let loggedMetadata: unknown = "not-called";
    const service = new skir.Service<unknown>({
      errorLogger: (errorInfo): void => {
        loggedMetadata = errorInfo.reqMeta;
      },
    });
    service.addMethod(
      squareMethod,
      async (request): Promise<number> => request,
    );
    const handler = service.withMetaTransformer((): never => {
      throw new Error("invalid auth");
    });
    const response = await handler.handleRequest("Square:1001::7", {});
    assert.equal(response.statusCode, 500);
    assert.equal(loggedMetadata, undefined);
  });

  it("returns a server error when response serialization fails", async () => {
    const responseSerializer = Object.create(
      skir.primitiveSerializer("int32"),
    ) as skir.Serializer<number>;
    responseSerializer.toJsonCode = (): never => {
      throw new Error("unsupported result");
    };
    const service = new skir.Service<unknown>();
    service.addMethod(
      { ...squareMethod, responseSerializer },
      async (request): Promise<number> => request,
    );
    const response = await service.handleRequest("Square:1001::7", {});
    assert.equal(response.statusCode, 500);
    assert.equal(
      response.data,
      "server error: can't serialize response to JSON: Error: unsupported result",
    );
  });
});

describe("Express adapter", () => {
  it("decodes GET queries and normalizes POST objects", async () => {
    const callbacks: Record<string, (...args: any[]) => Promise<void>> = {};
    const middlewareCalls: string[] = [];
    const bodies: skir.RawRequestBody[] = [];
    const app = {
      get(_path: string, callback: (...args: any[]) => Promise<void>): void {
        callbacks.get = callback;
      },
      post(
        _path: string,
        ...middleware: Array<(...args: any[]) => unknown>
      ): void {
        callbacks.post = middleware.at(-1) as (...args: any[]) => Promise<void>;
      },
    };
    const middleware = (name: string) => (): ((..._args: any[]) => void) => {
      middlewareCalls.push(name);
      return (): void => {};
    };
    const handler: skir.RequestHandler<any> = {
      handleRequest: async (body): Promise<skir.RawResponse> => {
        bodies.push(body);
        return { data: "ok", statusCode: 201, contentType: "text/plain" };
      },
    };
    const sent: unknown[] = [];
    const response = {
      status(code: number): typeof response {
        sent.push(code);
        return response;
      },
      contentType(value: string): typeof response {
        sent.push(value);
        return response;
      },
      send(value: unknown): void {
        sent.push(value);
      },
    };

    skir.installServiceOnExpressApp(
      app as any,
      "/rpc",
      handler,
      middleware("text") as any,
      middleware("json") as any,
      middleware("raw") as any,
    );
    await callbacks.get!(
      { originalUrl: "/rpc?Square%3A1001%3A%3A7" },
      response,
    );
    await callbacks.post!(
      { originalUrl: "/rpc", body: { method: 1001 } },
      response,
    );

    assert.deepEqual(middlewareCalls, ["text", "json", "raw"]);
    assert.deepEqual(bodies, ["Square:1001::7", '{"method":1001}']);
    assert.deepEqual(sent, [201, "text/plain", "ok", 201, "text/plain", "ok"]);
  });
});
