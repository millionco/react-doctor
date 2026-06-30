import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUsememoSimpleExpression } from "./no-usememo-simple-expression.js";

describe("performance/no-usememo-simple-expression — regressions", () => {
  it("stays silent on a template literal with an expensive interpolation", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      'function C({ rows }) { const label = useMemo(() => `${rows.map((r) => r.id).join(",")}`, [rows]); return <p>{label}</p>; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a trivially cheap memoized expression", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ x }) { const v = useMemo(() => x + 1, [x]); return <p>{v}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
