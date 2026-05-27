import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidPreferChildrenHelper } from "./solid-prefer-children-helper.js";

describe("solid-prefer-children-helper", () => {
  it("flags multiple props.children reads", () => {
    const result = runRule(
      solidPreferChildrenHelper,
      `const Panel = (props) => <div>{props.children}{props.children}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("2 times");
    expect(result.diagnostics[0].message).toContain("children");
  });

  it("does not flag single props.children read", () => {
    const result = runRule(
      solidPreferChildrenHelper,
      `const Panel = (props) => <div>{props.children}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag components without props param", () => {
    const result = runRule(solidPreferChildrenHelper, `const Panel = () => <div>hello</div>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-JSX functions", () => {
    const result = runRule(
      solidPreferChildrenHelper,
      `const util = (props) => props.children + props.children;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
