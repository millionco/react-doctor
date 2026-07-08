import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLegacyContextApi } from "./no-legacy-context-api.js";

describe("architecture/no-legacy-context-api — regressions", () => {
  it("flags a provider class using childContextTypes and getChildContext", () => {
    const result = runRule(
      noLegacyContextApi,
      `class ColorProvider extends React.Component {
  static childContextTypes = { color: PropTypes.string };
  getChildContext() {
    return { color: "red" };
  }
  render() {
    return <div>{this.props.children}</div>;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a top-level Component.contextTypes assignment", () => {
    const result = runRule(
      noLegacyContextApi,
      `const Button = (props, context) => <button>{context.color}</button>;
Button.contextTypes = { color: PropTypes.string };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
