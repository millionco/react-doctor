import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const runLegacyLinkRule = (source: string) =>
  runRule(jsxNoTargetBlank, source, {
    settings: {
      "react-doctor": { capabilities: ["target-blank-needs-explicit-protection"] },
    },
  });

describe("jsx-no-target-blank logical rel guard", () => {
  it("accepts a shared predicate protecting the explicit blank target", () => {
    const result = runLegacyLinkRule(`
      const Link = ({ openInTab }) =>
        <a href="https://example.test" target={openInTab ? "_blank" : "_self"}
           rel={openInTab && "noopener"} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when the other branch opens a blank target", () => {
    const result = runLegacyLinkRule(`
      const Link = ({ openInTab }) =>
        <a href="https://example.test" target={openInTab ? "_self" : "_blank"}
           rel={openInTab && "noopener"} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("jsx-no-target-blank logical rel boundaries", () => {
  it("accepts the reverse attribute order and case-insensitive HTML keywords", () => {
    const result = runLegacyLinkRule(
      'const Link = ({ flag }) => <a href="https://example.test" rel={flag && "external\\tNoOpEnEr"} target={flag ? "_BLANK" : "_PaReNt"} />;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    'const Link = ({ flag }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} data-step={flag = !flag} rel={flag && "noopener"} />;',
    'const Link = ({ flags }) => <a href="https://example.test" target={flags.open ? "_blank" : "_self"} rel={flags.open && "noopener"} />;',
    'const Link = () => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;',
    'import { flag } from "./flag"; const Link = () => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;',
    'const Link = ({ flag }) => <a href="https://example.test" target={flag() ? "_blank" : "_self"} rel={flag() && "noopener"} />;',
    'const Link = ({ flag, other }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={(flag && other) && "noopener"} />;',
    'const Link = ({ flag, getRel }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && getRel()} />;',
    'const Link = ({ flag }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag || "noopener"} />;',
    'const Link = ({ flag }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "external\\u00a0noopener"} />;',
    'const Link = ({ flag }) => <a href="https://example.test" xlinkHref="https://alt.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;',
    'const Link = ({ flag }) => <a href="https://example.test" xlink:href="https://alt.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;',
    'const Link = ({ flag }) => <a is="custom-anchor" href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;',
    'const Link = ({ flag }) => <svg><a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} /></svg>;',
    'const Svg = "svg"; const Link = ({ flag }) => <Svg><a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} /></Svg>;',
    'const Link = ({ flag, props }) => <a {...props} href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;',
    'const Link = ({ flag }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} rel={flag && ""} />;',
    'const Link = ({ flag }) => <><base target="_blank" /><a href="https://example.test" target={flag ? "_blank" : undefined} rel={flag && "noopener"} /></>;',
    'const Link = ({ flag }) => <><base target="_blank" /><a href="https://example.test" target={flag ? "_blank" : ""} rel={flag && "noopener"} /></>;',
    'const Link = ({ flag }) => <a href="https://example.test" target={flag ? "_blank" : "preview"} rel={flag && "noopener"} />;',
  ])("retains the existing warning without an exact proof: %s", (source) => {
    const result = runLegacyLinkRule(source);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the legacy noreferrer and faithful mode requirements", () => {
    const source =
      'const Link = ({ flag }) => <a href="https://example.test" target={flag ? "_blank" : "_self"} rel={flag && "noopener"} />;';
    const noreferrerRequired = runRule(jsxNoTargetBlank, source, {
      settings: {
        "react-doctor": {
          capabilities: ["target-blank-needs-explicit-protection", "target-blank-needs-noreferrer"],
        },
      },
    });
    const faithful = runRule(jsxNoTargetBlank, source, {
      settings: {
        "react-doctor": {
          capabilities: ["target-blank-needs-explicit-protection"],
          portedRuleMode: "faithful",
        },
      },
    });

    expect(noreferrerRequired.parseErrors).toEqual([]);
    expect(faithful.parseErrors).toEqual([]);
    expect(noreferrerRequired.diagnostics).toHaveLength(1);
    expect(faithful.diagnostics).toHaveLength(1);
  });
});
