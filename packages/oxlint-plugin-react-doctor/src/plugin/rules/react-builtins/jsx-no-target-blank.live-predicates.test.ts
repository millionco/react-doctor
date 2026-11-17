import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const settings = {
  "react-doctor": { capabilities: ["target-blank-needs-explicit-protection"] },
};

describe("react-builtins/jsx-no-target-blank — live protection predicates", () => {
  it.each([
    `import { enabled, flip } from "./flags";
    <a href="https://example.test" target={enabled ? "_blank" : "_self"}
      data-side={flip()} rel={enabled ? "noopener" : ""} />;`,
    `let enabledValue = false;
    Object.defineProperty(globalThis, "enabled", { get: () => (enabledValue = !enabledValue) });
    <a href="https://example.test" target={enabled ? "_blank" : "_self"}
      rel={enabled ? "noopener" : ""} />;`,
    `import { enabled, flip } from "./flags";
    const first = enabled;
    flip();
    const second = enabled;
    <a href="https://example.test" target={first ? "_blank" : "_self"}
      rel={second ? "noopener" : ""} />;`,
    `import { enabled, flip } from "./flags";
    const ready = true;
    <a href="https://example.test" target={ready && enabled ? "_blank" : "_self"}
      data-side={flip()} rel={!(ready && enabled) ? "" : "noopener"} />;`,
  ])("does not assume repeated live reads agree: %s", (code) => {
    const result = runRule(jsxNoTargetBlank, code, { settings });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `import { enabled, flip } from "./flags";
    const snapshot = enabled;
    const opposite = !snapshot;
    <a href="https://example.test" target={snapshot ? "_blank" : "_self"}
      data-side={flip()} rel={opposite ? "" : "noopener"} />;`,
    `const snapshot = enabled;
    <a href="https://example.test" target={snapshot ? "_blank" : "_self"}
      rel={snapshot ? "noopener" : ""} />;`,
    `const Anchor = ({ ready, enabled }) => (
      <a href="https://example.test" target={ready && enabled ? "_blank" : "_self"}
        rel={!(ready && enabled) ? "" : "noopener"} />
    );`,
    `import { enabled, flip } from "./flags";
    <a href="https://example.test" target={enabled ? "_blank" : "_self"}
      data-side={flip()} rel="noopener" />;`,
  ])("accepts proven protection: %s", (code) => {
    const result = runRule(jsxNoTargetBlank, code, { settings });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
