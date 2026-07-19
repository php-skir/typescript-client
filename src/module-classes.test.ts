import { describe, it } from "mocha";
import assert from "node:assert/strict";
import * as skir from "./skir-client.js";

interface ItemInitializer {
  key?: string;
  value?: number;
}

class Item extends skir._FrozenBase {
  declare static readonly DEFAULT: Item;
  declare static readonly Mutable: new (
    initializer?: ItemInitializer | Item,
  ) => MutableItem;
  declare static readonly create: (
    initializer?: ItemInitializer | Item | MutableItem,
  ) => Item;
  declare static readonly serializer: skir.Serializer<Item>;

  declare readonly key: string;
  declare readonly value: number;

  constructor(privateKey: symbol) {
    super(privateKey);
  }
}

interface MutableItem {
  key: string;
  value: number;
  toFrozen(): Item;
}

interface CatalogInitializer {
  items?: ReadonlyArray<ItemInitializer | Item | MutableItem>;
  selected?: ItemInitializer | Item | MutableItem;
}

class Catalog extends skir._FrozenBase {
  declare static readonly DEFAULT: Catalog;
  declare static readonly Mutable: new (
    initializer?: CatalogInitializer | Catalog,
  ) => MutableCatalog;
  declare static readonly create: (
    initializer?: CatalogInitializer | Catalog | MutableCatalog,
  ) => Catalog;
  declare static readonly serializer: skir.Serializer<Catalog>;

  declare readonly items: readonly Item[];
  declare readonly selected: Item;
  declare readonly findItem: (key: string) => Item | undefined;

  constructor(privateKey: symbol) {
    super(privateKey);
  }
}

interface MutableCatalog {
  items: readonly Item[];
  selected: Item | MutableItem;
  readonly mutableItems: Item[];
  readonly mutableSelected: MutableItem;
  toFrozen(): Catalog;
}

let catalogKeyFunctionCalls = 0;

skir._initModuleClasses("generated.skir", [
  {
    kind: "struct",
    ctor: Item,
    initFn: (target, initializer): void => {
      const output = target as MutableItem;
      const input = initializer as ItemInitializer;
      output.key = input.key ?? "";
      output.value = input.value ?? 0;
    },
    name: "Item",
    fields: [
      {
        name: "key",
        property: "key",
        number: 0,
        type: { kind: "primitive", primitive: "string" },
      },
      {
        name: "value",
        property: "value",
        number: 1,
        type: { kind: "primitive", primitive: "int32" },
      },
    ],
  },
  {
    kind: "struct",
    ctor: Catalog,
    initFn: (target, initializer): void => {
      const output = target as MutableCatalog;
      const input = initializer as CatalogInitializer;
      output.items = skir._toFrozenArray(input.items ?? [], Item.create);
      output.selected = Item.create(input.selected ?? {});
    },
    name: "Catalog",
    fields: [
      {
        name: "items",
        property: "items",
        number: 0,
        type: {
          kind: "array",
          item: { kind: "record", ctor: Item },
        },
        mutableGetter: "mutableItems",
        indexable: {
          searchMethod: "findItem",
          keyFn: (value): unknown => {
            catalogKeyFunctionCalls++;
            return (value as Item).key;
          },
          keyToHashable: (key): unknown =>
            String(key).toLocaleLowerCase("en-US"),
        },
      },
      {
        name: "selected",
        property: "selected",
        number: 1,
        type: { kind: "record", ctor: Item },
        mutableGetter: "mutableSelected",
      },
    ],
  },
] as any);

describe("generated module classes", () => {
  it("creates frozen values and exposes initialized descriptors", () => {
    const catalog = Catalog.create({
      items: [{ key: "Alpha", value: 1 }],
      selected: { key: "Selected", value: 2 },
    });

    assert(Object.isFrozen(catalog));
    assert(Object.isFrozen(catalog.items));
    assert.equal(Catalog.create(catalog), catalog);
    assert.equal(Catalog.serializer.typeDescriptor.qualifiedName, "Catalog");
    assert.match(catalog.toString(), /Alpha/);
    assert.throws(
      () => new Catalog(Symbol()),
      /Do not call the constructor directly/,
    );
  });

  it("returns stable mutable array and record views", () => {
    const frozen = Catalog.create({
      items: [{ key: "Alpha", value: 1 }],
      selected: { key: "Selected", value: 2 },
    });
    const mutable = frozen.toMutable() as MutableCatalog;

    const items = mutable.mutableItems;
    assert.notEqual(items, frozen.items);
    assert.equal(mutable.mutableItems, items);
    items.push(Item.create({ key: "Beta", value: 3 }));

    const selected = mutable.mutableSelected;
    assert.equal(mutable.mutableSelected, selected);
    selected.value = 4;

    const result = mutable.toFrozen();
    assert.deepEqual(
      result.items.map((item) => item.key),
      ["Alpha", "Beta"],
    );
    assert.equal(result.selected.value, 4);
  });

  it("copies an array again after the mutable field is replaced", () => {
    const frozen = Catalog.create({ items: [{ key: "Alpha" }] });
    const mutable = frozen.toMutable() as MutableCatalog;
    const firstMutableArray = mutable.mutableItems;
    mutable.items = frozen.items;

    assert.notEqual(mutable.mutableItems, frozen.items);
    assert.notEqual(mutable.mutableItems, firstMutableArray);
  });

  it("indexes frozen arrays once and applies key normalization", () => {
    catalogKeyFunctionCalls = 0;
    const first = Item.create({ key: "Duplicate", value: 1 });
    const last = Item.create({ key: "duplicate", value: 2 });
    const catalog = Catalog.create({ items: [first, last] });

    assert.equal(catalog.findItem("DUPLICATE"), last);
    assert.equal(catalog.findItem("missing"), undefined);
    assert.equal(catalog.findItem("duplicate"), last);
    assert.equal(catalogKeyFunctionCalls, 2);
  });
});
