# Skir TypeScript Client

[![Tests](https://github.com/php-skir/typescript-client/actions/workflows/tests.yml/badge.svg)](https://github.com/php-skir/typescript-client/actions/workflows/tests.yml)
[![Coverage](https://raw.githubusercontent.com/php-skir/typescript-client/badges/coverage.svg)](https://github.com/php-skir/typescript-client/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/@php-skir/skir-client?label=npm&logo=npm)](https://www.npmjs.com/package/@php-skir/skir-client)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/php-skir/typescript-client)](LICENSE)

Library imported from TypeScript code generated from skir files.

Install with:
```shell
npm i @php-skir/skir-client
```

## CBOR transport

The default SkirRPC transport stays compatible with upstream Skir. To exchange
CBOR request and response bodies, opt in on both the client and service:

```typescript
const client = new ServiceClient("https://example.com/rpc", undefined, {
  transportCodec: "cbor",
});

const service = new Service({ transportCodec: "cbor" });
```

CBOR transport sends a `{ method, request }` envelope as `application/cbor` and
encodes the response value as `application/cbor`.

When installing a CBOR-enabled service on Express, pass Express's `raw`
middleware as the sixth argument:

```typescript
installServiceOnExpressApp(app, "/rpc", service, text, json, raw);
```

See:

*   [skir](https://github.com/gepheum/skir): home of the skir compiler
*   [skir-typescript-gen](https://github.com/gepheum/skir-typescript-gen): skir to TypeScript code generator
*   [skir-typescript-example](https://github.com/gepheum/skir-typescript-example): example showing how to use skir's TypeScript code generator in a project
