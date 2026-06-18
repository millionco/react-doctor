import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverFetchWithoutRevalidate } from "./server-fetch-without-revalidate.js";

const FETCH_WITHOUT_REVALIDATE = `export const GET = () => {
  return fetch("https://example.com/api/data");
};`;

describe("server-fetch-without-revalidate", () => {
  it("runs on App Router files with supported JS/TS module extensions", () => {
    const routeResult = runRule(serverFetchWithoutRevalidate, FETCH_WITHOUT_REVALIDATE, {
      filename: "/repo/app/api/users/route.mjs",
    });
    const pageResult = runRule(serverFetchWithoutRevalidate, FETCH_WITHOUT_REVALIDATE, {
      filename: "/repo/app/users/page.mts",
    });

    expect(routeResult.diagnostics).toHaveLength(1);
    expect(pageResult.diagnostics).toHaveLength(1);
  });

  it("does not run on unsupported CommonJS module extensions", () => {
    const result = runRule(serverFetchWithoutRevalidate, FETCH_WITHOUT_REVALIDATE, {
      filename: "/repo/app/api/users/route.cjs",
    });

    expect(result.diagnostics).toEqual([]);
  });

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it(`does not flag a ${method} fetch (Next.js never caches non-GET requests)`, () => {
      const result = runRule(
        serverFetchWithoutRevalidate,
        `export const POST = () => {
  return fetch("https://example.com/api/data", { method: "${method}", body: "{}" });
};`,
        { filename: "/repo/app/api/users/route.ts" },
      );

      expect(result.diagnostics).toEqual([]);
    });
  }

  it("flags a GET fetch with an explicit method but no caching config", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export const GET = () => {
  return fetch("https://example.com/api/data", { method: "GET" });
};`,
      { filename: "/repo/app/api/users/route.ts" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fetch whose method is a non-literal (can't prove it's non-GET)", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export const GET = (method: string) => {
  return fetch("https://example.com/api/data", { method });
};`,
      { filename: "/repo/app/api/users/route.ts" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
