import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferStableEmptyFallback } from "./prefer-stable-empty-fallback.js";

describe("prefer-stable-empty-fallback", () => {
  it("flags `prop || []` fallback to a same-file memoised consumer", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const PostList = memo(({ posts }) => null);

      function App(props) {
        return <PostList posts={props.posts || []} />;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Hoist");
  });

  it("flags `prop ?? {}` fallback to a memoised consumer", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const ConfigBlock = memo(({ settings }) => null);

      function App(props) {
        return <ConfigBlock settings={props.settings ?? {}} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags nested member-chain non-empty side", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const Table = memo(({ rows }) => null);

      function App(props) {
        return <Table rows={props.data.records || []} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the consumer is not memoised", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      const PostList = ({ posts }) => null;

      function App(props) {
        return <PostList posts={props.posts || []} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag intrinsic HTML elements", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      function App(props) {
        return <div data-rows={props.rows || []} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag when the non-empty side is itself an allocation", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const List = memo(({ items }) => null);

      function App() {
        return <List items={makeItems() || []} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag JSX outside a function (module-level)", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const PostList = memo(({ posts }) => null);
      const data = { posts: undefined };

      export default <PostList posts={data.posts || []} />;
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a non-empty fallback (`prop || other`)", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const PostList = memo(({ posts }) => null);

      function App(props) {
        return <PostList posts={props.posts || props.fallback} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the inverted symmetric shape `[] || value` (dead-code typo, not a perf footgun)", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const List = memo(({ items }) => null);

      function App(props) {
        return <List items={[] || props.fallback} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the inverted symmetric shape `{} ?? value`", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const Config = memo(({ settings }) => null);

      function App(props) {
        return <Config settings={{} ?? props.fallback} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not double-flag with jsx-no-new-array-as-prop's case", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo } from "react";

      const PostList = memo(({ posts }) => null);

      function App(props) {
        return <PostList posts={[1, 2, 3]} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag when the consumer is wrapped in forwardRef alone (not memoised)", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { forwardRef } from "react";

      const Input = forwardRef(({ items }, ref) => null);

      function App(props) {
        return <Input items={props.items || []} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags when the consumer is wrapped in memo(forwardRef(...))", () => {
    const result = runRule(
      preferStableEmptyFallback,
      `
      import { memo, forwardRef } from "react";

      const Input = memo(forwardRef(({ items }, ref) => null));

      function App(props) {
        return <Input items={props.items || []} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
