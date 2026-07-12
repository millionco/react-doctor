import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverCacheWithObjectLiteral } from "./server-cache-with-object-literal.js";

describe("server/server-cache-with-object-literal — regressions", () => {
  it("flags calling a same-file cache(fn) wrapper with an object literal", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params) => db.user.find(params));
export const loadUser = async () => getUser({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the cached function is called with a primitive", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (id) => db.user.find(id));
export const loadUser = async () => getUser(1);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["freeze", "seal"])("flags a fresh cache key wrapped with Object.%s", (methodName) => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params) => db.user.find(params));
export const loadUser = async () => getUser(Object.${methodName}({ id: 1 }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fresh cache key through nested integrity wrappers", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params) => db.user.find(params));
export const loadUser = async () => getUser(Object.freeze(Object.seal({ id: 1 })));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a stable module-scoped frozen cache key", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params) => db.user.find(params));
const params = Object.freeze({ id: 1 });
export const loadUser = async () => getUser(params);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a shadowed Object.freeze implementation", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params) => db.user.find(params));
const Object = { freeze: () => stableParams };
export const loadUser = async () => getUser(Object.freeze({ id: 1 }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
