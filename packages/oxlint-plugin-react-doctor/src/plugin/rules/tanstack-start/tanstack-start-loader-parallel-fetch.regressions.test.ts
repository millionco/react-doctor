import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartLoaderParallelFetch } from "./tanstack-start-loader-parallel-fetch.js";

const ROUTE = { filename: "src/routes/index.tsx" };

describe("tanstack-start/tanstack-start-loader-parallel-fetch — regressions", () => {
  it("stays silent on a dependent await chain (cannot be parallelized)", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const user = await getUser(); const posts = await getPosts(user.id); return { user, posts }; } });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a dependency is laundered through a non-await variable", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const user = await getUser(); const id = user.id; const posts = await getPosts(id); return { user, posts }; } });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags two independent awaits (a real waterfall)", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const a = await fetchA(); const b = await fetchB(); return { a, b }; } });`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags sibling awaits that both depend on one parent (pairwise parallelizable)", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const user = await getUser(); const posts = await getPosts(user.id); const comments = await getComments(user.id); return { user, posts, comments }; } });`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a strictly chained three-step await sequence", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const user = await getUser(); const posts = await getPosts(user.id); const comments = await getComments(posts[0].id); return { user, posts, comments }; } });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a chain laundered through an intermediate binding at each step", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const user = await getUser(); const id = user.id; const posts = await getPosts(id); const firstPost = posts[0]; const comments = await getComments(firstPost.id); return { comments }; } });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags an independent await after a dependent one (getTeams alongside getUser)", () => {
    const { diagnostics } = runRule(
      tanstackStartLoaderParallelFetch,
      `createFileRoute('/x')({ loader: async () => { const user = await getUser(); const posts = await getPosts(user.id); const teams = await getTeams(); return { user, posts, teams }; } });`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
