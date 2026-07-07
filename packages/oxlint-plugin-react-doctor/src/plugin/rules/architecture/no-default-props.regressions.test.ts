import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDefaultProps } from "./no-default-props.js";

describe("architecture/no-default-props — regressions", () => {
  // FN hunt (innovaccer design-system): the rule fired zero times across the
  // whole corpus because `defaultEnabled: false` kept it out of the default
  // scan set ON TOP of the `react:19` gate — double-gated into permanent
  // silence. The version gate itself is correct (`defaultProps` still works
  // on React 17/18, so the removal hint is noise there); pin that exact
  // wiring: on by default, gated to React 19+ and nothing more.
  it("is enabled by default, gated only by the React 19 capability", () => {
    expect(noDefaultProps.defaultEnabled).not.toBe(false);
    expect(noDefaultProps.requires).toEqual(["react:19"]);
  });

  it("flags a defaultProps assignment on an arrow function component", () => {
    const result = runRule(
      noDefaultProps,
      `export const Link = (props) => <a {...props} />;
Link.defaultProps = { appearance: 'default', size: 'regular', disabled: false };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags a defaultProps assignment on a function declaration component", () => {
    const result = runRule(
      noDefaultProps,
      `function Dialog(props) { return <div role="dialog" {...props} />; }
Dialog.defaultProps = { dimension: 'small' };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent on a lowercase object with a defaultProps property", () => {
    const result = runRule(noDefaultProps, `config.defaultProps = { size: 'sm' };`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on computed access", () => {
    const result = runRule(noDefaultProps, `Link['defaultProps'] = { size: 'sm' };`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
