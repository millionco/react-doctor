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

  it("does not flag the next/og static-asset fetch (new URL with import.meta.url)", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export async function GET() {
  const font = await fetch(new URL("../../fonts/Mono.ttf", import.meta.url)).then((res) =>
    res.arrayBuffer(),
  );
  return new Response(font);
}`,
      { filename: "src/app/api/og/route.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a Remix route.tsx even though it lives under app/", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `import { useLoaderData } from "@remix-run/react";
export const loader = async () => {
  const data = await fetch("https://api.example.com/feed");
  return data.json();
};
export default function Page() {
  const data = useLoaderData();
  return <div>{data.title}</div>;
}`,
      { filename: "apps/webapp/app/routes/feed/route.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a Next.js page whose only router import is type-only", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `import type { LinkProps } from "react-router";
export default async function Page() {
  const data = await fetch("https://api.example.com/feed");
  return <div>{(await data.json()).title}</div>;
}`,
      { filename: "src/app/feed/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a runtime-URL fetch in an og route handler", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `export async function GET() {
  const feed = await fetch("https://api.example.com/feed");
  return Response.json(await feed.json());
}`,
      { filename: "src/app/api/og/route.tsx" },
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

  it("does not apply Next global fetch caching semantics to node-fetch imports", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `import fetch from "node-fetch";
export async function GET() {
  const response = await fetch("https://api.github.com/repos/millionco/react-doctor");
  return Response.json(await response.json());
}`,
      { filename: "docs/app/funding.json/route.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a named import",
      `import { fetch } from "undici";
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
    ["a parameter", `export const GET = (fetch) => fetch("https://api.example.com/feed");`],
    [
      "a function declaration",
      `function fetch(url) { return request(url); }
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
    [
      "a local wrapper",
      `const fetch = (...args) => globalThis.fetch(...args);
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
    [
      "a reassigned binding",
      `let fetch = globalThis.fetch;
fetch = customFetch;
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
    [
      "a multi-hop userland alias",
      `const request = customFetch;
const fetch = request;
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
    [
      "a bound global method",
      `const fetch = globalThis.fetch.bind(globalThis);
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
    [
      "a shadowed globalThis receiver",
      `const globalThis = { fetch: customFetch };
const fetch = globalThis.fetch;
export const GET = () => fetch("https://api.example.com/feed");`,
    ],
  ])("does not apply Next caching semantics to %s named fetch", (_name, code) => {
    const result = runRule(serverFetchWithoutRevalidate, code, {
      filename: "src/app/feed/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an unbound global fetch reportable inside a nested function", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `const loadFeed = () => fetch("https://api.example.com/feed");
export const GET = () => loadFeed();`,
      { filename: "src/app/feed/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const fetch = globalThis.fetch;",
    `const fetch = globalThis["fetch"];`,
    "const fetch = (globalThis.fetch as typeof globalThis.fetch);",
    "const firstFetch = globalThis.fetch; const fetch = firstFetch;",
    "const { fetch } = globalThis;",
    `const { ["fetch"]: fetch } = globalThis;`,
    `const { fetch: firstFetch } = globalThis; const fetch = firstFetch;`,
  ])("keeps an exact immutable global fetch alias reportable: %s", (declaration) => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `${declaration}
export const GET = () => fetch("https://api.example.com/feed");`,
      { filename: "src/app/feed/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a nested fetch parameter suppress a separate global fetch finding", () => {
    const result = runRule(
      serverFetchWithoutRevalidate,
      `const loadLocal = (fetch) => fetch("https://local.example.com/feed");
export const GET = () => {
  loadLocal(customFetch);
  return fetch("https://api.example.com/feed");
};`,
      { filename: "src/app/feed/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
