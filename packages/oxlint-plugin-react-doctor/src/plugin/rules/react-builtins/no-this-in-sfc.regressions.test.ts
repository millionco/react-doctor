import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noThisInSfc } from "./no-this-in-sfc.js";

describe("react-builtins/no-this-in-sfc — regressions", () => {
  // A PascalCase ES5 constructor is not an SFC — `this` is the real
  // instance. The render-output gate keeps it quiet.
  it("stays silent on a PascalCase constructor function", () => {
    const result = runRule(
      noThisInSfc,
      `function Stack() {
        this.items = [];
        this.size = 0;
      }
      Stack.prototype.push = function (x) { this.items.push(x); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a PascalCase constructor function expression", () => {
    const result = runRule(
      noThisInSfc,
      `const Vector = function (x, y) {
        this.x = x;
        this.y = y;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // A real SFC that uses `this` and renders JSX must still fire.
  it("still flags `this` in a JSX-returning function component", () => {
    const result = runRule(noThisInSfc, `const Foo = (props) => <span>{this.props.foo}</span>`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // JSX produced inside a callback argument (map, useMemo, …) flows into
  // the outer component's render, so it is render-output evidence for the
  // outer function — the nested-function boundary must not swallow it.
  it("flags this.props in an SFC whose JSX lives only in a map callback", () => {
    const result = runRule(
      noThisInSfc,
      `function Table(props) {
        const rows: Array<{ id: string }> = this.props.rows;
        return rows.map((row) => <tr key={row.id} />);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // A nested component DEFINITION (bound to a name) is its own render
  // unit — its JSX must not make the enclosing PascalCase factory look
  // like an SFC.
  it("stays silent on a PascalCase factory whose only JSX is a nested component definition", () => {
    const result = runRule(
      noThisInSfc,
      `function Builder(options) {
        this.options = options;
        const Preview = () => <div>{options.label}</div>;
        return Preview;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // prod-fp 2026-07: a PascalCase constructor that hands a JSX-returning
  // callback to a call (`mount(() => <div/>)`) satisfies the render-output
  // gate (call-argument JSX counts as render evidence), so every `this`
  // member in the constructor was flagged. The `this.<member> = …` write
  // is the constructor signature an SFC can never have.
  it("stays silent on a PascalCase constructor that registers a JSX callback", () => {
    const result = runRule(
      noThisInSfc,
      `function Tooltip(anchor) {
        this.anchor = anchor;
        this.visible = false;
        mount(() => <div className="tip">{this.anchor.title}</div>);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a PascalCase factory that increments a this counter around JSX callbacks", () => {
    const result = runRule(
      noThisInSfc,
      `const Carousel = function (element) {
        this.index = 0;
        element.addEventListener("click", () => {
          this.index++;
          render(<Slide index={this.index} />, element);
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // A this-write inside a NESTED function (own `this`) must not excuse
  // the outer SFC's `this.props` read.
  it("still flags an SFC whose nested function writes to its own this", () => {
    const result = runRule(
      noThisInSfc,
      `function Foo(props) {
        function track() { this.count = 1; }
        return <div onClick={track}>{this.props.foo}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
