import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoScriptUrl } from "./jsx-no-script-url.js";

describe("react-builtins/jsx-no-script-url — regressions", () => {
  // FP wave 4: the obfuscation regex was unanchored, so an ordinary
  // https URL that merely CONTAINS `JavaScript:` deeper in its path was
  // flagged. The protocol must start the URL to be dangerous.
  it("does not flag a real URL containing 'JavaScript:' in its path", () => {
    const result = runRule(
      jsxNoScriptUrl,
      `const A = () => <a href="https://en.wikipedia.org/wiki/JavaScript:_The_Good_Parts">x</a>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a genuine javascript: protocol URL", () => {
    const result = runRule(jsxNoScriptUrl, `const A = () => <a href="javascript:void(0)">x</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Leading whitespace / control chars before the protocol still count —
  // browsers strip them before resolving the scheme.
  it("still flags javascript: behind leading whitespace", () => {
    const result = runRule(
      jsxNoScriptUrl,
      `const A = () => <a href="  javascript:alert(1)">x</a>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
