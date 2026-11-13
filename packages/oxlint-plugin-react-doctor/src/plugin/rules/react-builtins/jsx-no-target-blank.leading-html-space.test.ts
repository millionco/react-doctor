import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const settings = {
  "react-doctor": {
    capabilities: ["target-blank-needs-explicit-protection", "target-blank-needs-noreferrer"],
    jsxNoTargetBlank: { forms: true },
  },
  react: {
    linkComponents: [{ name: "Link", linkAttribute: "to" }],
    formComponents: [{ name: "Form", formAttribute: "destination" }],
  },
};

describe("react-builtins/jsx-no-target-blank — leading HTML whitespace", () => {
  it.each([
    '<a href=" https://example.test " target="_blank" />;',
    String.raw`<a href={"\t\n\r\f//example.test "} target="_blank" />;`,
    'const href = " https://example.test"; <a href={href} target="_blank" />;',
    '<a href={` https://example.test`} target="_blank" />;',
    '<a {...{ href: " //example.test", target: "_blank" }} />;',
    '<form action=" https://example.test " target="_blank" />;',
  ])("flags an external native destination: %s", (code) => {
    const result = runRule(jsxNoTargetBlank, code, { settings });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    '<a href=" /docs//index " target="_blank" />;',
    String.raw`<a href={"\u00a0https://example.test"} target="_blank" />;`,
    '<a href=" https://example.test " target="_blank" rel="noreferrer" />;',
    '<Link to=" https://example.test " target="_blank" />;',
    '<Form destination=" https://example.test " target="_blank" />;',
  ])("keeps other destination policies: %s", (code) => {
    const result = runRule(jsxNoTargetBlank, code, { settings });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not enable native form checks by default", () => {
    const result = runRule(
      jsxNoTargetBlank,
      '<form action=" https://example.test " target="_blank" />;',
      { settings: { "react-doctor": { capabilities: settings["react-doctor"].capabilities } } },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
