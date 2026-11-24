import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

const getDiagnostics = ({
  initialValue = "makeCache(0)",
  otherWrite = "setCache(previous => ({ ...previous, epoch: 1 }));",
  beforeCopy = "",
  guard = "writable === base.entries",
  declaration = "",
  afterCopy = "",
} = {}) => {
  const result = runRule(
    noSideEffectInStateUpdaterFunction,
    `
    import { useState } from "react";
    const makeCache = (epoch) => ({ epoch, entries: new Map() });
    ${declaration}
    export function View({ epoch, rows, borrow, inspect }) {
      const [cache, setCache] = useState(() => ${initialValue});
      const current = cache.epoch === epoch ? cache : null;
      const update = () => {
        ${otherWrite}
        setCache(previous => {
          const base = previous.epoch === epoch ? previous : makeCache(epoch);
          let writable = base.entries;
          for (const row of rows) {
            const existing = writable.get(row.id);
            if (existing === undefined) {
              ${beforeCopy}
              if (${guard}) writable = new Map(writable);
              writable.set(row.id, row);
              ${afterCopy}
            }
          }
          if (base === previous && writable === base.entries) return previous;
          return { ...base, entries: writable };
        });
      };
      return <button onClick={update}>{current?.entries.size}</button>;
    }
    `,
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("guarded Maps stored in private state records", () => {
  it("allows a write after the borrowed Map has been copied", () => {
    expect(getDiagnostics()).toHaveLength(0);
  });

  it.each([
    ["stores an opaque record", { otherWrite: "setCache(() => borrow());" }],
    ["lets the setter escape", { otherWrite: "inspect(setCache);" }],
    ["reads an accessor", { initialValue: "({ epoch, get entries() { return borrow(); } })" }],
    ["allows the base record to escape", { beforeCopy: "inspect(base);" }],
    ["compares against a different field", { guard: "writable === base.other" }],
    ["overwrites Map's set method", { declaration: "Map.prototype.set = fakeSet;" }],
  ])("keeps the write warning when it %s", (_label, options) => {
    expect(getDiagnostics(options).length).toBeGreaterThan(0);
  });

  it("keeps both warnings when the record also has a borrowed mutation", () => {
    expect(getDiagnostics({ afterCopy: "base.entries.set(row.id, row);" })).toHaveLength(2);
  });
});

const getPreviousRecordCopyDiagnostics = ({
  copy = "previous.items",
  reset,
  initialValue = "{ items: new Map(), defaults: new Map() }",
  afterCopy = "",
  beforeCopy = "",
}: {
  copy?: string;
  reset?: string;
  initialValue?: string;
  afterCopy?: string;
  beforeCopy?: string;
} = {}) => {
  const result = runRule(
    noSideEffectInStateUpdaterFunction,
    `
    import { useState } from "react";
    export function Items({ item, loadItems, inspect }) {
      const [inventory, setInventory] = useState(() => (${initialValue}));
      const update = () => {
        ${reset ?? ""}
        setInventory(previous => {
          let next = previous.items;
          ${beforeCopy}
          if (next === previous.items) next = new Map(${copy});
          next.set(item, true);
          ${afterCopy}
          return next === previous.items ? previous : { ...previous, items: next };
        });
      };
      return <button onClick={update}>{inventory.items.size}</button>;
    }
    `,
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("guarded copies of the previous state's Map field", () => {
  it.each(["previous.items", "next"])("accepts cloning %s behind the identity guard", (copy) => {
    expect(getPreviousRecordCopyDiagnostics({ copy })).toHaveLength(0);
  });

  it("accepts an expression-bodied writer with a proved unchanged branch", () => {
    expect(
      getPreviousRecordCopyDiagnostics({
        reset: "setInventory(previous => previous.items.size ? previous : { items: new Map() });",
      }),
    ).toHaveLength(0);
  });

  it.each([
    ["copies another field", { copy: "previous.defaults" }],
    ["copies through computed access", { copy: 'previous["items"]' }],
    ["reads a getter", { initialValue: "{ get items() { return loadItems(); } }" }],
    ["escapes its record", { beforeCopy: "inspect(previous);" }],
    ["escapes its map", { beforeCopy: "inspect(previous.items);" }],
    [
      "can adopt external state from its unchanged-state writer",
      { reset: "setInventory(previous => previous.items.size ? previous : loadItems());" },
    ],
  ])("retains the write warning when it %s", (_description, options) => {
    expect(getPreviousRecordCopyDiagnostics(options).length).toBeGreaterThan(0);
  });

  it("retains the borrowed write after a guarded copy", () => {
    expect(
      getPreviousRecordCopyDiagnostics({ afterCopy: "previous.items.set(item, true);" }),
    ).toHaveLength(2);
  });
});

it("retains the warning when a host reference can replace the Map provider", () => {
  const result = runRule(
    noSideEffectInStateUpdaterFunction,
    `
    import { useState } from "react";
    export function List({ id, mapProvider }) {
      const [store, setStore] = useState(() => ({ entries: new Map() }));
      const attach = (node) => {
        const view = node?.ownerDocument.defaultView;
        if (view) view.Map = mapProvider;
      };
      const update = () => {
        setStore(previous => {
          let next = previous.entries;
          if (next === previous.entries) next = new Map(previous.entries);
          next.set(id, true);
          return next === previous.entries ? previous : { ...previous, entries: next };
        });
      };
      return <button ref={attach} onClick={update}>{store.entries.size}</button>;
    }
    `,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
});
