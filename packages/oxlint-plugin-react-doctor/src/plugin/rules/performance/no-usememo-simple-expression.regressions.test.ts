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

  it("flags a trivial array literal memo whose result is only read through members", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ x }) { const items = useMemo(() => [x], [x]); return <p>{items.length}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a trivial object literal memo that is immediately destructured", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ a, b }) { const { total } = useMemo(() => ({ total: a + b, parts: 2 }), [a, b]); return <p>{total}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a trivial tuple memo destructured into locals", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ x, y }) { const [first, second] = useMemo(() => [x, y], [x, y]); return <p>{first}{second}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the memoized object is passed as a JSX prop (identity matters)", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ color }) { const style = useMemo(() => ({ color }), [color]); return <Child style={style} />; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the memoized array feeds another hook's deps (identity matters)", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ x }) { const deps = useMemo(() => [x], [x]); useEffect(() => { sync(deps); }, [deps]); return null; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the memoized container is returned from a custom hook", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function useThing({ x }) { return useMemo(() => [x, x + 1], [x]); }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a container literal with a spread element", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ items }) { const copy = useMemo(() => [...items], [items]); return <p>{copy.length}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a container whose members are non-trivial to build", () => {
    const result = runRule(
      noUsememoSimpleExpression,
      "function C({ rows }) { const stats = useMemo(() => ({ ids: rows.map((row) => row.id) }), [rows]); return <p>{stats.ids.length}</p>; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
