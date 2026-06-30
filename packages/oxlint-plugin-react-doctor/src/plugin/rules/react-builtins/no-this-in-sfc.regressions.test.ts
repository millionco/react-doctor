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
});
