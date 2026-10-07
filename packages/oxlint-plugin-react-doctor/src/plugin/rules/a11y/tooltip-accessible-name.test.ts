import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { roleSupportsAriaProps } from "./role-supports-aria-props.js";

describe("tooltip accessible names", () => {
  it.each(["aria-label", "aria-labelledby", "aria-braillelabel"])(
    "accepts %s on the tooltip role",
    (attribute) => {
      const result = runRule(
        roleSupportsAriaProps,
        `const Hint = () => <div role="tooltip" ${attribute}="hint">Details</div>;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each(["generic", "presentation", "paragraph"])(
    "still rejects an author name on the %s role",
    (role) => {
      const result = runRule(
        roleSupportsAriaProps,
        `const Hint = () => <div role="${role}" aria-label="hint">Details</div>;`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("still rejects unsupported tooltip state", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const Hint = () => <div role="tooltip" aria-checked="true">Details</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
