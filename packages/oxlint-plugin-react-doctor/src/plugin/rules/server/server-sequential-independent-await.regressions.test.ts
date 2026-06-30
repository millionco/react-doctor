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
