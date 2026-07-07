import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDefaultProps } from "./no-default-props.js";

describe("architecture/no-default-props — regressions", () => {
  // FN hunt (innovaccer design-system): the rule fired zero times across the
  // whole corpus because `defaultEnabled: false` kept it out of the default
  // scan set and `requires: ["react:19"]` gated it off pre-19 projects — the
  // published prompt says "Enabled when: always". Pin the wiring so it can't
  // silently drop out of the default set again.
  it("is enabled by default with no capability gate", () => {
    expect(noDefaultProps.defaultEnabled).not.toBe(false);
    expect(noDefaultProps.requires).toBeUndefined();
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
