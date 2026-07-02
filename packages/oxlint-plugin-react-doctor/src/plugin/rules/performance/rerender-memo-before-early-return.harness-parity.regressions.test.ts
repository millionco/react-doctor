import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderMemoBeforeEarlyReturn } from "./rerender-memo-before-early-return.js";

// PR #994 fp-review: `return (<Heavy />);` inside the useMemo callback is the
// dominant real-world formatting. Production oxlint sees a plain JSXElement
// return argument; the harness previously kept a ParenthesizedExpression
// wrapper that made callbackReturnsJsx never match, disabling the rule in
// every paren-wrapped fixture. parse-fixture now strips parens to match.
describe("performance/rerender-memo-before-early-return — parenthesized JSX parity", () => {
  it("flags a paren-wrapped JSX return in the memo callback when the early return ignores the memo", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => { return (<Heavy />); }, []); if (cond) { return null; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a paren-wrapped JSX return when the early return uses the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => { return (<Heavy />); }, []); if (cond) { return content; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
