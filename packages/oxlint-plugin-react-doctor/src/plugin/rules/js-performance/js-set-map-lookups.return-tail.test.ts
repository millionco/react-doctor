import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

describe("js-set-map-lookups lexical return tail", () => {
  it("keeps the repeated lookup and skips the lookup that cannot repeat", () => {
    const result = runRule(
      jsSetMapLookups,
      `function select(allowed, cursor, values) {
        for (const value of values) {
          if (allowed.includes(value)) remember(value);
        }
        while (cursor) {
          if (cursor.ready) {
            try { inspect(cursor); } catch { return false; }
            if (cursor.active && allowed.includes(cursor.id)) return true;
            if (cursor.hidden) return false;
            const fallback = prepare(cursor);
            store(fallback);
            return false;
          }
          cursor = cursor.next;
        }
      }`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([3]);
  });

  it("can exit multiple enclosing loops with the same function return", () => {
    const result = runRule(
      jsSetMapLookups,
      `function select(allowed, groups) {
        for (const group of groups) {
          for (const item of group) {
            if (allowed.includes(item)) return true;
            return false;
          }
        }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["fallthrough", "while (next()) { if (allowed.includes(value)) remember(value); }"],
    ["continue", "while (next()) { if (allowed.includes(value)) continue; return false; }"],
    [
      "labeled continue",
      "outer: while (next()) { if (allowed.includes(value)) continue outer; return false; }",
    ],
    [
      "finally overrides return",
      "while (next()) { try { if (allowed.includes(value)) return true; return false; } finally { continue; } }",
    ],
    [
      "catch can reenter the loop",
      "while (next()) { try { if (allowed.includes(value)) return true; return false; } catch {} }",
    ],
    [
      "switch break",
      "while (next()) { switch (mode) { case 1: { if (allowed.includes(value)) break; return false; } } }",
    ],
    [
      "inner break leaves the outer loop active",
      "while (next()) { while (inner()) { if (allowed.includes(value)) break; return false; } }",
    ],
    [
      "return from an iteration callback",
      "values.forEach((item) => { if (allowed.includes(item)) return true; return false; });",
    ],
    [
      "an iteration callback can reenter the inner loop",
      "values.forEach(() => { while (next()) { if (allowed.includes(value)) return true; return false; } });",
    ],
    [
      "an enclosing loop can reenter an immediately invoked function",
      "while (next()) { (() => { while (inner()) { if (allowed.includes(value)) return true; return false; } })(); }",
    ],
  ])("still reports with %s", (_name, body) => {
    const result = runRule(
      jsSetMapLookups,
      `function select(allowed, values, value, mode) { ${body} }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
