import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const runLegacyLinkRule = (code: string) =>
  runRule(jsxNoTargetBlank, code, {
    settings: {
      "react-doctor": { capabilities: ["target-blank-needs-explicit-protection"] },
    },
  });

describe("jsx-no-target-blank correlated attributes", () => {
  it("accepts blank targets that only pair with a relative destination", () => {
    const result = runLegacyLinkRule(`
      const Link = ({ isExternal }) =>
        <a href={isExternal ? "https://example.com/" : "/docs"}
           target={isExternal ? "_self" : "_blank"}>Docs</a>;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when the external destination can pair with a blank target", () => {
    const result = runLegacyLinkRule(`
      const Link = ({ isExternal }) =>
        <a href={isExternal ? "https://example.com/" : "/docs"}
           target={isExternal ? "_blank" : "_self"}>Docs</a>;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("jsx-no-target-blank correlation boundaries", () => {
  it.each([
    `const Link = ({ isExternal }) => <a
      href={!isExternal ? "/docs" : "https://example.com/"}
      target={isExternal ? "_self" : "_blank"} />;`,
    `const Link = ({ isExternal }) => {
      const isInternal = !isExternal;
      return <a {...{ href: isExternal ? "https://example.com/" : "/docs",
        target: isInternal ? "_blank" : "_self" }} />;
    };`,
  ])("accepts a proven relative blank destination: %s", (source) => {
    const result = runLegacyLinkRule(source);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const Link = ({ isExternal, shouldStay }) => <a
      href={isExternal ? "https://example.com/" : "/docs"}
      target={shouldStay ? "_self" : "_blank"} />;`,
    `const Link = ({ isExternal }) => <a
      href={isExternal() ? "https://example.com/" : "/docs"}
      target={isExternal() ? "_self" : "_blank"} />;`,
    `const Link = () => <a href={flag ? "https://example.com/" : "/docs"}
      target={flag ? "_self" : "_blank"} />;`,
    `import { flag } from "./flag";
      const Link = () => <a href={flag ? "https://example.com/" : "/docs"}
        target={flag ? "_self" : "_blank"} />;`,
    `const Link = ({ flag }) => {
      const href = flag ? "https://example.com/" : "/docs";
      flag = !flag;
      return <a href={href} target={flag ? "_self" : "_blank"} />;
    };`,
    `const Link = ({ flag }) => <a href={flag ? "https://example.com/" : "/docs"}
      data-value={eval("flag = !flag")} target={flag ? "_self" : "_blank"} />;`,
    `const Link = ({ flag }) => <a href={flag ? "https://example.com/" : "/docs"}
      target={flag ? "_self" : "_blank"} {...{ target: "_blank" }} />;`,
    `const Link = ({ flag }) => <a href={flag ? "https://example.com/" : "/docs"}
      target="_blank" rel={flag ? "" : "noreferrer"} />;`,
    `const Link = ({ flag, unknownHref }) => <a
      href={flag ? "https://example.com/" : unknownHref}
      target={flag ? "_self" : "_blank"} />;`,
  ])("preserves the warning without a complete stable correlation: %s", (source) => {
    const result = runLegacyLinkRule(source);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the configured dynamic destination policy", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Link = ({ flag, unknownHref }) => <a
        href={flag ? "https://example.com/" : unknownHref}
        target={flag ? "_self" : "_blank"} />;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { enforceDynamicLinks: "never" },
          },
        },
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([" https://example.com/", "/\t/example.com/", "/\\example.com/"])(
    "does not mistake browser URL preprocessing for a proven relative destination: %j",
    (unsafeHref) => {
      const result = runLegacyLinkRule(
        `const Link = ({ flag }) => <a
          href={flag ? "https://example.com/" : ${JSON.stringify(unsafeHref)}}
          target={flag ? "_self" : "_blank"} />;`,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    '""',
    "undefined",
    "void 0",
    "null",
    "0",
    '"review-window"',
    'preferParent ? "_parent" : ""',
  ])(
    "retains the warning with a base target and an external branch target of %s",
    (externalTarget) => {
      const result = runLegacyLinkRule(`
        const Link = ({ flag, preferParent }) => <>
          <base target="_blank" />
          <a href={flag ? "https://example.com/" : "/docs"}
            target={flag ? (${externalTarget}) : "_blank"} />
        </>;
      `);

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(["_SELF", "_parent", "_ToP"])(
    "accepts explicit non-blank HTML target %s even with a base target",
    (externalTarget) => {
      const result = runLegacyLinkRule(`
        const Link = ({ flag }) => <>
          <base target="_blank" />
          <a href={flag ? "https://example.com/" : "/docs"}
            target={flag ? ${JSON.stringify(externalTarget)} : "_blank"} />
        </>;
      `);

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it("preserves the faithful port behavior", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Link = ({ flag }) => <a href={flag ? "https://example.com/" : "/docs"}
        target={flag ? "_self" : "_blank"} />;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            portedRuleMode: "faithful",
          },
        },
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'TARGET="_blank"',
    'HREF="https://outside.example/"',
    'is="custom-anchor"',
    'xlinkHref="https://outside.example/"',
    '{...{ TARGET: "_blank" }}',
  ])("keeps the warning when native attributes can differ: %s", (attribute) => {
    const result = runLegacyLinkRule(`
      const Link = ({ flag }) => <a href={flag ? "https://example.com/" : "/docs"}
        target={flag ? "_self" : "_blank"} ${attribute} />;
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves explicit spread warnings when effective attributes are unknown", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Link = ({ flag, props }) => <a href={flag ? "https://example.com/" : "/docs"}
        target={flag ? "_self" : "_blank"} {...props} />;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { warnOnSpreadAttributes: true },
          },
        },
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("A spread");
  });
});
