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
});
