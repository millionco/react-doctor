import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFocusableContentInRoleText } from "./no-focusable-content-in-role-text.js";

describe("no-focusable-content-in-role-text", () => {
  it("reports native and explicitly tabbable descendants", () => {
    const result = runRule(
      noFocusableContentInRoleText,
      `const View = () => <span role="text"><button>Open</button><span tabIndex={0}>More</span></span>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts plain text and disabled controls", () => {
    const result = runRule(
      noFocusableContentInRoleText,
      `const View = () => <span role="text">Total <button disabled>Help</button></span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer focusability across a custom component", () => {
    const result = runRule(
      noFocusableContentInRoleText,
      `const View = () => <span role="text"><Wrapper><button>Open</button></Wrapper></span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
