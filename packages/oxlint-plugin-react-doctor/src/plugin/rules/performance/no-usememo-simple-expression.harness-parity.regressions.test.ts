import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUsememoSimpleExpression } from "./no-usememo-simple-expression.js";

const expectFires = (code: string): void => {
  const result = runRule(noUsememoSimpleExpression, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

// PR #994 fp-review: production oxlint has no ParenthesizedExpression, so a
// parenthesized arrow body like `() => (a ? b : c)` is a bare
// ConditionalExpression at runtime (confirmed end-to-end on the ant-design
// repo). The harness previously kept the wrapper and reported nothing on
// these shapes; parse-fixture now strips parens so the harness matches
// production and the rule's core-contract ternary shapes stay pinned.
describe("performance/no-usememo-simple-expression — parenthesized body parity", () => {
  it("fires on the ant-design Header/index.tsx:303 shape (parenthesized ternary of literals)", () => {
    expectFires(
      "function C({ direction }) { const label = useMemo(() => (direction !== 'rtl' ? 'RTL' : 'LTR'), [direction]); return <p>{label}</p>; }",
    );
  });

  it("fires on the ant-design useSizes.ts:93 shape (React.useMemo parenthesized ternary of identifiers)", () => {
    expectFires(
      "import * as React from 'react';\nfunction useSizes({ containerSize, postPxSizes, sizes }) { return React.useMemo(() => (containerSize ? postPxSizes : sizes), [containerSize, postPxSizes, sizes]); }",
    );
  });

  it("fires on the burhanuday must-detect anchor shape written with a parenthesized body", () => {
    expectFires(
      "function C({ hideOnMobile, breakpoint }) { const [windowSize] = useState({ width: 0 }); const should = useMemo(() => (hideOnMobile ? windowSize.width > breakpoint : true), [windowSize, breakpoint, hideOnMobile]); return <p>{should}</p>; }",
    );
  });
});
