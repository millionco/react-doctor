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

  it("flags a fresh cache key when the integrity receiver has a TypeScript wrapper", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params) => db.user.find(params));
export const loadUser = async () => getUser((Object as any).freeze({ id: 1 }));`,
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

  it("flags a fresh object in any argument position, not just first", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (id, params) => db.user.find(id, params));
export const loadUser = async () => getUser(1, { sort: "name" });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a fresh array argument", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUsers = cache(async (ids) => db.user.findMany(ids));
export const loadUsers = async () => getUsers([1, 2, 3]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags calling a renamed cache import with an object literal", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache as memoize } from "react";
const getUser = memoize(async (params) => db.user.find(params));
export const loadUser = async () => getUser({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags calling an immutable alias with an object literal", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const memoize = cache;
const getUser = memoize(async (params) => db.user.find(params));
export const loadUser = async () => getUser({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when cache import is shadowed by a local function", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache as reactCache } from "react";
const cache = (fn) => fn;
const getUser = cache(async (params) => db.user.find(params));
export const loadUser = async () => getUser({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the cached function name is shadowed by a parameter", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const read = cache(async (params) => db.user.find(params));
export const loadUser = async (read) => read({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags the real cached function when a parameter shadows its name elsewhere", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const read = cache(async (params) => db.user.find(params));
const unrelated = (read) => read({ id: 1 });
export const loadUser = async () => read({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when cache is imported from a non-React module", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "memory-cache";
const getUser = cache(async (params) => db.user.find(params));
export const loadUser = async () => getUser({ id: 1 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports once per call, not once per fresh argument", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `import { cache } from "react";
const getUser = cache(async (params, options) => db.user.find(params, options));
export const loadUser = async () => getUser({ id: 1 }, { include: ["posts"] });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("stays silent when a cached function alias is reassigned", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `
      import { cache } from "react";
      const read = cache(load);
      let alias = read;
      alias = other;
      export const result = alias({ id: 1 });
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports through a chain of immutable cached function aliases", () => {
    const result = runRule(
      serverCacheWithObjectLiteral,
      `
      import { cache } from "react";
      const read = cache(load);
      const alias = read;
      const secondAlias = alias;
      export const result = secondAlias({ id: 1 });
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
