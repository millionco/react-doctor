import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

// FN hunt: the rule was deleted in #735 on the grounds that modern browsers
// imply `noopener` for `target="_blank"` — but the implicit behavior never
// covers `noreferrer`, and the published prompt still documents the rule as
// always-enabled. These pin the exact corpus shapes that went unreported
// while the rule was missing.
describe("react-builtins/jsx-no-target-blank — regressions", () => {
  it("flags an external link with target=_blank and no rel (internxt AuthShell)", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const AuthFooter = () => (
        <a href="https://internxt.com/legal" target="_blank" className="auth-footer-link">
          legal
        </a>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags an external link wrapped in other markup (mapguide about)", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const About = () => (
        <p><a target="_blank" href="https://github.com/jumpinjackie/mapguide-react-layout">GitHub</a></p>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags an external help-article link with no rel (internxt PasswordFieldWithInfo)", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Info = () => (
        <a href="https://help.internxt.com/en/articles/8450457" target="_blank">how?</a>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when rel includes noreferrer", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Safe = () => (
        <a href="https://internxt.com/legal" target="_blank" rel="noopener noreferrer">legal</a>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a relative internal link", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Internal = () => <a href="/legal" target="_blank">legal</a>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
