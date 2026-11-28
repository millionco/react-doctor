import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxCurlyBracePresence } from "./jsx-curly-brace-presence.js";

describe("JSX braces around literal children", () => {
  it("preserves the braces around a child with a source comment", () => {
    const result = runRule(jsxCurlyBracePresence, '<div>{/* A label note. */ "Saved"}</div>');
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports unnecessary braces around a URL", () => {
    const result = runRule(jsxCurlyBracePresence, '<div>{"https://example.com"}</div>');
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
