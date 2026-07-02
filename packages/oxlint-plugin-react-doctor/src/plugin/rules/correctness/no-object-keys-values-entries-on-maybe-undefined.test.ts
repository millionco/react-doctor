import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noObjectKeysValuesEntriesOnMaybeUndefined } from "./no-object-keys-values-entries-on-maybe-undefined.js";

describe("no-object-keys-values-entries-on-maybe-undefined", () => {
  it("flags Object.entries on an optional param (Faire web-api shape)", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function buildParams(params?: any) {
        return Object.entries(params);
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Object.keys on an optional param", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(options?: Record<string, unknown>) {
        return Object.keys(options);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Object.values on an optional param", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      const f = (data?: any) => Object.values(data);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Object.keys on an optional-chained member argument", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const list = Object.keys(response?.data);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a `?? {}` fallback", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        return Object.keys(params ?? {});
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional-chained member with a `?? {}` fallback", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const list = Object.keys(response?.data ?? {});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a required (non-optional) param", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params: Record<string, any>) {
        return Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a param with a default value", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params = {}) {
        return Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside an enclosing `if (x)` guard", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        if (params) {
          return Object.keys(params);
        }
        return [];
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after an early-return guard", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        if (!params) return [];
        return Object.entries(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `&&` short-circuit guard", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        return params && Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ternary consequent guarded by the param", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        return params ? Object.keys(params) : [];
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain local variable", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f() {
        const data = { a: 1 };
        return Object.keys(data);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when Object is shadowed by a local binding", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        const Object = { keys: () => [] };
        return Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `&&` guard wrapped in a `.length > 0` comparison", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(hunkContextHashes?: Record<number, string>) {
        if (hunkContextHashes && Object.keys(hunkContextHashes).length > 0) {
          return true;
        }
        return false;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the isEmpty idiom `!x || Object.keys(x).length === 0`", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function isEmpty(params?: Record<string, unknown>) {
        return !params || Object.keys(params).length === 0;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a re-chained argument behind a `&&` guard on the same path", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const x = response?.data && Object.keys(response?.data);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a re-chained argument inside an `if` guard on the same path", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(response) {
        if (response?.data) {
          return Object.keys(response?.data);
        }
        return [];
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after a `params = params ?? {}` normalization", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: Record<string, unknown>) {
        params = params ?? {};
        return Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after an `if (!params) params = {}` normalization", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function g(params?: Record<string, unknown>) {
        if (!params) params = {};
        return Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a negated ternary with the call in the alternate", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(params?: any) {
        return !params ? [] : Object.keys(params);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a negated `if`/`else` with the call in the else branch", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function g(params?: any) {
        if (!params) {
          return [];
        } else {
          return Object.entries(params);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a re-chained argument when the guard covers a different path", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `
      function f(response) {
        if (response?.meta) {
          return Object.keys(response?.data);
        }
        return [];
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an optional-chained argument inside a test file", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const list = Object.keys(response?.data);`,
      { filename: "keys.test.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
