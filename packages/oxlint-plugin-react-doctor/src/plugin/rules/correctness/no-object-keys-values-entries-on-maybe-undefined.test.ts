import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noObjectKeysValuesEntriesOnMaybeUndefined } from "./no-object-keys-values-entries-on-maybe-undefined.js";

describe("no-object-keys-values-entries-on-maybe-undefined", () => {
  it("flags Object.entries on an optional param (api-client shape)", () => {
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

  it("does not flag after a disjunctive early-return guard", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function appendQuery(query?: Record<string, string>) {
        if (!query || !Object.keys(query).length) return "";
        return Object.entries(query).map(([key, value]) => key + value).join("&");
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after a typeof and null disjunctive early-return guard", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function entries(alias?: Record<string, string>) {
        if (!alias || typeof alias !== "object" || alias === null) return [];
        return Object.entries(alias);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags after a conjunction that can exit while the value is present", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function entries(alias?: Record<string, string>, skip?: boolean) {
        if (!alias && skip) return [];
        return Object.entries(alias);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag inside a .then callback of a promise chain ending in .catch", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export default async function MediumBlogs() {
        return fetch('/medium.json')
          .then(response => response.json())
          .then(data => {
            const posts = Object.values(data?.payload?.references?.Post);
            return posts.slice(0, 3);
          })
          .catch(error => {
            console.error('Error fetching Medium data:', error);
            return [];
          });
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags inside a .then callback when the chain has no .catch", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const load = () =>
        fetch('/medium.json')
          .then(response => response.json())
          .then(data => Object.values(data?.payload?.references?.Post));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a computed-index chain argument guarded by a length early-return on the array", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const useColumns = (data) => {
        return useMemo(() => {
          const rows = data?.data ?? [];
          if (rows.length === 0) {
            return [];
          }
          return Object.keys(rows?.[0]).map((key) => ({ dataKey: key }));
        }, [data?.data]);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a computed-index chain argument with no guard on the array", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const columnsOf = (rows) => Object.keys(rows?.[0]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the same && chain truthiness-guards the optional param through a method wrapper", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function getColumnVisibility(columns: string[], defaultVisibility?: Record<string, boolean>) {
        const allDefaultsTrue = defaultVisibility && Object.values(defaultVisibility).every((v) => v === true);
        return allDefaultsTrue;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a typeof+null conjunction guards the optional param before the call", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export const queried = (path: string, params?: Record<string, unknown>): string => {
        const keys =
          typeof params === "object" &&
          params !== null &&
          Object.keys(params).filter((key) => /string|number/.test(typeof params[key]));
        if (keys && keys.length > 0) return path + "?" + keys.join("&");
        return path;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not credit a branch where the value is known missing", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function keys(payload) {
         if (payload?.data === undefined) return Object.keys(payload?.data);
         return [];
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("credits the alternate branch of an absence check", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const keys = (payload) => payload?.data === undefined ? [] : Object.keys(payload?.data);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports static computed Object method access", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const keys = Object["keys"](payload?.data);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a catch binding named Object as the global builtin", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `try { load(); } catch (Object) { Object.keys(payload?.data); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an Object.keys call in the branch where an optional parameter is absent", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function read(params?: object) {
         if (!params) return Object.keys(params);
         return [];
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat assignment to undefined as normalization", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function read(params?: object) {
         params = undefined;
         return Object.keys(params);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a conditional assignment as dominating normalization", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `function read(params?: object, flag: boolean) {
         if (flag) params = {};
         return Object.keys(params);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an empty catch link as consuming the thrown TypeError", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `fetch("/x").then(data => Object.keys(data?.items)).catch();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a rethrowing catch as consuming the thrown TypeError", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `fetch("/x")
         .then(data => Object.keys(data?.items))
         .catch(error => { throw error; });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a dominating local null-predicate early exit", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `const isEmptyOrNull = (value) => value == null;
      function keys(value?: object) {
        if (isEmptyOrNull(value)) return [];
        return Object.keys(value);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
