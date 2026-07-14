import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInteractiveElementToNoninteractiveRole } from "./no-interactive-element-to-noninteractive-role.js";

describe("a11y/no-interactive-element-to-noninteractive-role regressions", () => {
  it("accepts the native-equivalent `cell` role on an interactive `<td>`", () => {
    const result = runRule(
      noInteractiveElementToNoninteractiveRole,
      `<td role="cell" tabIndex={0} onMouseDown={handleMouseDown} onKeyDown={handleKeyDown}>Value</td>`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports the noninteractive `cell` role on a native `<button>`", () => {
    const result = runRule(
      noInteractiveElementToNoninteractiveRole,
      `<button role="cell">Value</button>`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
