import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderMemoBeforeEarlyReturn } from "./rerender-memo-before-early-return.js";

describe("performance/rerender-memo-before-early-return — regressions", () => {
  it("stays silent when the early return uses the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => <Heavy />, []); if (cond) { return content; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when the early return ignores the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => <Heavy />, []); if (cond) { return null; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
