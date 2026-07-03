import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

describe("server-sequential-independent-await — regressions", () => {
  it("stays silent when the first await is an auth/permission gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export async function load() {
  const session = await requireSession();
  const orders = await getOrders();
  return orders;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the first await is a connection/side-effect gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export async function load() {
  const conn = await connectDatabase();
  const rows = await fetchRows();
  return rows;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when both awaits are on promises started earlier (already parallel)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `async function load() {
  const userPromise = fetchUser();
  const postsPromise = fetchPosts();
  const user = await userPromise;
  const posts = await postsPromise;
  return { user, posts };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when one await is a Next.js request-scoped API (headers)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `import { headers } from "next/headers";
export default async function Page() {
  const headersList = await headers();
  const rows = await fetchRows();
  return rows;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the first await is a next-intl server helper", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `import { getTranslations } from "next-intl/server";
export default async function Page() {
  const t = await getTranslations("Home");
  const session = await getSession();
  return session;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when awaiting Next.js 15 promise props (params/searchParams)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export default async function Page(props) {
  const searchParams = await props.searchParams;
  const { segments } = await props.params;
  return segments;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a fetch pair when a same-named local headers() is not the Next.js API", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `import { headers } from "./my-io.js";
export default async function Page() {
  const headersList = await headers();
  const rows = await fetchRows();
  return rows;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags two genuinely independent data fetches", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export default async function Page() {
  const user = await fetchUser();
  const posts = await fetchPosts();
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
