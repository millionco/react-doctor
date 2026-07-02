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

  it("does not flag an inline options object that spreads options which may carry revalidate", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `const cacheOptions = { next: { revalidate: 60 } };
export default async function Page() {
  await fetch("https://api.example.com/feed", { ...cacheOptions, headers: { a: "b" } });
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not flag a string-literal "cache" key', () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export default async function Page() {
  await fetch("https://api.example.com/feed", { "cache": "no-store" });
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not flag a string-literal "next" key with revalidate', () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export default async function Page() {
  await fetch("https://api.example.com/feed", { "next": { revalidate: 60 } });
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a computed dynamic key as a cache key", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export default async function Page(cacheKey) {
  await fetch("https://api.example.com/feed", { [cacheKey]: "no-store" });
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an inline options object with only unrelated properties", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export default async function Page() {
  await fetch("https://api.example.com/feed", { headers: { a: "b" } });
  return null;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
