import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoNewObjectAsProp } from "./jsx-no-new-object-as-prop.js";

const expectFail = (code: string): void => {
  const result = runRule(jsxNoNewObjectAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsxNoNewObjectAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

// Hand-written coverage for the memoised-consumer gate (mirrors
// `jsx-no-new-function-as-prop`). Every OXC fail fixture passes a plain
// consumer and is skipped in `oxc-divergences.ts`, so these tests are the
// only fail-coverage for the rule. They mirror the object-producing
// SHAPES the OXC fixtures exercised (inline literal, `Object.assign` /
// `Object.create` / `new Object` / `Object()`, logical / conditional
// fallbacks, render-local binding) against a same-file `memo()` consumer.
// A plain `foo` prop is used (not `config`/`options`/`style`/etc.) so the
// config-shape / always-fresh prop-name skips don't suppress the rule.
const memoised = (jsx: string): string =>
  `import { memo } from "react";\nconst Item = memo(() => null);\n${jsx}`;

describe("react-builtins/jsx-no-new-object-as-prop — regressions", () => {
  it("flags an inline object literal", () => {
    expectFail(memoised(`const Foo = () => <Item foo={{ a: 1 }} />;`));
  });

  it("flags `Object.assign(...)`", () => {
    expectFail(memoised(`const Foo = ({ base }) => <Item foo={Object.assign({}, base)} />;`));
  });

  it("flags `Object.create(...)`", () => {
    expectFail(memoised(`const Foo = () => <Item foo={Object.create(null)} />;`));
  });

  it("flags `new Object()`", () => {
    expectFail(memoised(`const Foo = () => <Item foo={new Object()} />;`));
  });

  it("flags a logical-fallback object (`value || { a: 1 }`)", () => {
    expectFail(memoised(`const Foo = ({ value }) => <Item foo={value || { a: 1 }} />;`));
  });

  it("flags a conditional object (`cond ? value : {}`)", () => {
    expectFail(memoised(`const Foo = ({ cond, value }) => <Item foo={cond ? value : {}} />;`));
  });

  it("flags a render-local object binding", () => {
    expectFail(memoised(`const Foo = () => { const value = {}; return <Item foo={value} />; };`));
  });

  it("does not flag the same object on a non-memoised consumer", () => {
    expectPass(`const Item = () => null;\nconst Foo = () => <Item foo={{ a: 1 }} />;`);
  });

  it("does not flag on a lazy() consumer — lazy defers loading but does not memoize", () => {
    expectPass(
      `import { lazy } from "react";\nconst Item = lazy(() => import("./item.js"));\nconst Foo = () => <Item foo={{ a: 1 }} />;`,
    );
  });

  // Verify wave: `memo(fn, arePropsEqual)` compares props with the
  // author's own function, which routinely ignores reference identity
  // (antd MemoInput, json-edit-react CollectionNode) — a fresh object
  // cannot break that bailout.
  it("does not flag when the memo consumer has a custom comparator", () => {
    expectPass(
      `import { memo } from "react";
      const Item = memo((props) => props.children, (prev, next) => isSimilar(prev.foo, next.foo));
      const Foo = ({ base }) => <Item foo={{ ...base, extra: 1 }} />;`,
    );
  });

  it("does not flag a React.memo consumer with a custom comparator", () => {
    expectPass(
      `import React from "react";
      const CollectionNode = React.memo(CollectionNodeBase, areNodePropsEqual);
      const Foo = ({ value }) => <CollectionNode foo={{ value }} />;`,
    );
  });

  it("still flags a memo consumer without a comparator", () => {
    expectFail(memoised(`const Foo = ({ base }) => <Item foo={{ ...base }} />;`));
  });
});
