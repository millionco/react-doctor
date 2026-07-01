import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlineHocOnComponent } from "./no-inline-hoc-on-component.js";

describe("no-inline-hoc-on-component", () => {
  it("flags an inline arrow passed to observer", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Header = observer((props) => {
        return <h1>{props.store.title}</h1>;
      });`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline function expression passed to withRouter", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withRouter(function (props) {
        return <div>{props.location.pathname}</div>;
      });`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a curried HOC call assigned to a component binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Card = connect(mapState)((props) => (
        <article>{props.title}</article>
      ));`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Mantine's factory component primitive", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const AreaChart = factory<AreaChartFactory>((_props) => {
        return <div>{_props.title}</div>;
      });`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Mantine's polymorphicFactory component primitive", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Badge = polymorphicFactory<BadgeFactory>((_props) => <span>{_props.label}</span>);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a real HOC whose name merely contains but does not end in factory", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Container = createRefetchContainer((props) => {
        return <section>{props.children}</section>;
      });`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the extracted-reference form", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const ComponentBase = (props) => <div>{props.content}</div>;
       const Component = hoc(ComponentBase);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useCallback render callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const renderRow = useCallback(() => <Row />, []);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useMemo render callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const RenderRow = useMemo(() => <Row />, []);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag forwardRef", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Squared = forwardRef((props, ref) => (
        <div ref={ref} {...props} />
      ));`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag memo", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Card = memo((props) => <article>{props.title}</article>);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag styled factory calls", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Img = styled((props) => <img alt="" {...props} />)\`\`;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a map iteration callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const list = items.map((it) => <Row key={it.id} item={it} />);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member-callee helper handed an inline JSX function", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Rendered = lib.render((props) => <div {...props} />);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a class render method", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `class Panel {
        render() {
          return <Test />;
        }
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a wrapper whose inline function has no JSX", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const sum = wrap((a, b) => a + b);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an HOC result assigned to a lowercase binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const rendered = act((props) => <div {...props} />);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a function that only renders JSX in a nested non-returned callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Wrapped = wrapData((rows) => {
        rows.forEach((row) => <Cell value={row} />);
        return rows.length;
      });`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
