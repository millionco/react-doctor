import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverFetchWithoutRevalidate } from "./server-fetch-without-revalidate.js";

describe("server/server-fetch-without-revalidate — regressions", () => {
  it("does not flag a fetch whose options object is passed by identifier", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `const options = { next: { revalidate: 60 } };
export default async function Page() {
  await fetch("https://api.example.com/feed", options);
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a bare fetch with no caching config", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export default async function Page() {
  await fetch("https://api.example.com/feed");
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
