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
