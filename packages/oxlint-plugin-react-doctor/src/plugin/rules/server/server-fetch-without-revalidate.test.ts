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
});
