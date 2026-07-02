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

  it("stays silent on the mined ant-design shape: template literal with simple interpolations", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ demoUrl, isDark }) { const demoUrlWithTheme = useMemo(() => { return `${demoUrl}${isDark ? '?theme=dark' : ''}`; }, [demoUrl, isDark]); return <a href={demoUrlWithTheme}>demo</a>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an expression-body template literal with one interpolation", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ name }) { const greeting = useMemo(() => `hi ${name}`, [name]); return <p>{greeting}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a zero-interpolation template literal", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C() { const label = useMemo(() => `static label`, []); return <p>{label}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags the burhanuday must-detect anchor: paren-wrapped ternary body", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ hideOnMobile, breakpoint }) { const [windowSize] = useState({ width: 0 }); const should = useMemo(() => (hideOnMobile ? windowSize.width > breakpoint : true), [windowSize, breakpoint, hideOnMobile]); return <p>{should}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a paren-wrapped ternary of literals", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ direction }) { const label = useMemo(() => (direction !== 'rtl' ? 'RTL' : 'LTR'), [direction]); return <p>{label}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
