import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const LEGACY_CHROMIUM_SETTINGS = {
  "react-doctor": { capabilities: ["target-blank-needs-explicit-protection"] },
};

const LEGACY_NOOPENER_UNSUPPORTED_SETTINGS = {
  "react-doctor": {
    capabilities: ["target-blank-needs-explicit-protection", "target-blank-needs-noreferrer"],
  },
};

const runLegacyChromiumRule = (code: string) =>
  runRule(jsxNoTargetBlank, code, { settings: LEGACY_CHROMIUM_SETTINGS });

const runNoreferrerRequiredRule = (code: string) =>
  runRule(jsxNoTargetBlank, code, { settings: LEGACY_NOOPENER_UNSUPPORTED_SETTINGS });

describe("react-builtins/jsx-no-target-blank — target-aware regressions", () => {
  it("flags an external blank-target anchor without rel for legacy Chromium", () => {
    const result = runLegacyChromiumRule(
      'const Link = () => <a href="https://example.com" target="_blank">Example</a>;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts noopener for legacy Chromium", () => {
    const result = runLegacyChromiumRule(
      'const Link = () => <a href="https://example.com" target="_blank" rel="noopener">Example</a>;',
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires noreferrer when noopener support is unavailable", () => {
    const result = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" rel="noopener">Example</a>;',
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a misspelled noreferrer token when noopener support is unavailable", () => {
    const result = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" rel="norefferrer">Example</a>;',
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts noreferrer when noopener support is unavailable", () => {
    const result = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" rel="noreferrer">Example</a>;',
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps relative links quiet", () => {
    const relative = runNoreferrerRequiredRule(
      'const Link = () => <a href="/docs" target="_blank">Docs</a>;',
    );

    expect(relative.diagnostics).toHaveLength(0);
  });

  it("uses explicit attributes after a spread when they are authoritative", () => {
    const result = runNoreferrerRequiredRule(
      'const Link = ({ props }) => <a {...props} href="https://example.com" target="_blank" rel="norefferrer">Example</a>;',
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a link quiet when a later unknown spread can override its attributes", () => {
    const result = runNoreferrerRequiredRule(
      'const Link = ({ props }) => <a href="https://example.com" target="_blank" {...props}>Example</a>;',
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes that a later object spread can provide protection or override the target", () => {
    const protectedLink = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" {...{ rel: "noreferrer" }}>Example</a>;',
    );
    const retargetedLink = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" {...{ target: "_self" }}>Example</a>;',
    );

    expect(protectedLink.diagnostics).toHaveLength(0);
    expect(retargetedLink.diagnostics).toHaveLength(0);
  });

  it("does not treat embedded double slashes as an external URL", () => {
    const nestedPath = runNoreferrerRequiredRule(
      'const Link = () => <a href="/docs//getting-started" target="_blank">Docs</a>;',
    );
    const relativeText = runNoreferrerRequiredRule(
      'const Link = () => <a href="foo//bar" target="_blank">Docs</a>;',
    );

    expect(nestedPath.diagnostics).toHaveLength(0);
    expect(relativeText.diagnostics).toHaveLength(0);
  });

  it("preserves an explicit allowReferrer override for IE targets", () => {
    const result = runRule(
      jsxNoTargetBlank,
      'const Link = () => <a href="https://example.com" target="_blank" rel="noopener">Example</a>;',
      {
        settings: {
          "react-doctor": {
            capabilities: [
              "target-blank-needs-explicit-protection",
              "target-blank-needs-noreferrer",
            ],
            jsxNoTargetBlank: { allowReferrer: true },
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves an explicit noreferrer requirement for Chromium targets", () => {
    const result = runRule(
      jsxNoTargetBlank,
      'const Link = () => <a href="https://example.com" target="_blank" rel="noopener">Example</a>;',
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { allowReferrer: false },
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats non-identifier destination expressions as dynamic in always mode", () => {
    const result = runNoreferrerRequiredRule(`
      const Links = ({ user, getHref, protocol, host, primary, fallback }) => <>
        <a href={user.profileUrl} target="_blank">Profile</a>
        <a href={getHref()} target="_blank">Generated</a>
        <a href={\`${"${protocol}"}//${"${host}"}\`} target="_blank">Template</a>
        <a href={protocol + "//example.com"} target="_blank">Concatenated</a>
        <a href={primary || fallback} target="_blank">Logical</a>
        <a href={(primary, fallback)} target="_blank">Sequence</a>
      </>;
    `);

    expect(result.diagnostics).toHaveLength(6);
  });

  it("keeps non-identifier destination expressions quiet in never mode", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Link = ({ user, getHref }) => <>
        <a href={user.profileUrl} target="_blank">Profile</a>
        <a href={getHref()} target="_blank">Generated</a>
      </>;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { enforceDynamicLinks: "never" },
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches protection tokens case-insensitively when referrers are allowed", () => {
    const settings = {
      "react-doctor": {
        capabilities: ["target-blank-needs-explicit-protection"],
        jsxNoTargetBlank: { allowReferrer: true },
      },
    };
    const noopener = runRule(
      jsxNoTargetBlank,
      '<a href="https://example.com" target="_blank" rel="NOOPENER">Example</a>',
      { settings },
    );
    const noreferrer = runRule(
      jsxNoTargetBlank,
      '<a href="https://example.com" target="_blank" rel="NoReFeRrEr">Example</a>',
      { settings },
    );

    expect(noopener.diagnostics).toHaveLength(0);
    expect(noreferrer.diagnostics).toHaveLength(0);
  });

  it("evaluates ordered statically known object spreads", () => {
    const unsafeSpread = runNoreferrerRequiredRule(
      'const Link = () => <a {...{ href: "https://example.com", target: "_blank" }}>Example</a>;',
    );
    const harmlessSpread = runNoreferrerRequiredRule(
      'const Link = () => <a {...{ id: "docs" }} href="https://example.com" target="_blank">Example</a>;',
    );
    const protectedAfterSpread = runNoreferrerRequiredRule(
      'const Link = () => <a {...{ href: "https://example.com", target: "_blank" }} rel="noreferrer">Example</a>;',
    );
    const protectionOverriddenBySpread = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" rel="noreferrer" {...{ rel: "" }}>Example</a>;',
    );
    const targetOverriddenBySpread = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" {...{ target: "_self" }}>Example</a>;',
    );

    expect(unsafeSpread.diagnostics).toHaveLength(1);
    expect(harmlessSpread.diagnostics).toHaveLength(1);
    expect(protectedAfterSpread.diagnostics).toHaveLength(0);
    expect(protectionOverriddenBySpread.diagnostics).toHaveLength(1);
    expect(targetOverriddenBySpread.diagnostics).toHaveLength(0);
  });

  it("resolves const spread aliases with lexical shadowing", () => {
    const aliased = runNoreferrerRequiredRule(`
      const unsafeProps = { href: "https://example.com", target: "_blank" };
      const forwardedProps = unsafeProps;
      const Link = () => <a {...forwardedProps}>Example</a>;
    `);
    const shadowed = runNoreferrerRequiredRule(`
      const props = { href: "https://example.com", target: "_blank" };
      const Link = () => {
        const props = { href: "/docs", target: "_blank" };
        return <a {...props}>Example</a>;
      };
    `);

    expect(aliased.diagnostics).toHaveLength(1);
    expect(shadowed.diagnostics).toHaveLength(0);
  });

  it("does not trust a const object alias after a property write", () => {
    const protectedBeforeSpread = runNoreferrerRequiredRule(`
      const props = { href: "https://example.com", target: "_blank" };
      props.rel = "noreferrer";
      const Link = () => <a {...props}>Example</a>;
    `);
    const changedBeforeSpread = runNoreferrerRequiredRule(`
      const props = { href: "https://example.com", target: "_blank", rel: "noreferrer" };
      props.rel = getRel();
      const Link = () => <a {...props}>Example</a>;
    `);
    const changedAfterSpread = runNoreferrerRequiredRule(`
      const props = { href: "https://example.com", target: "_blank" };
      const element = <a {...props}>Example</a>;
      props.rel = "noreferrer";
    `);

    expect(protectedBeforeSpread.diagnostics).toHaveLength(0);
    expect(changedBeforeSpread.diagnostics).toHaveLength(0);
    expect(changedAfterSpread.diagnostics).toHaveLength(1);
  });

  it("does not trust a const object alias after an opaque mutation or escape", () => {
    const passedToCall = runNoreferrerRequiredRule(`
      const props = { href: "https://example.com", target: "_blank" };
      prepareProps(props);
      const Link = () => <a {...props}>Example</a>;
    `);
    const methodCall = runNoreferrerRequiredRule(`
      const props = { href: "https://example.com", target: "_blank" };
      props.prepare();
      const Link = () => <a {...props}>Example</a>;
    `);

    expect(passedToCall.diagnostics).toHaveLength(0);
    expect(methodCall.diagnostics).toHaveLength(0);
  });

  it("flattens nested static spreads in property order", () => {
    const protectedLink = runNoreferrerRequiredRule(`
      const destination = "https://example.com";
      const base = { href: destination, ["target"]: "_blank" };
      const protectedProps = { ...base, rel: "noreferrer" };
      const Link = () => <a {...protectedProps}>Example</a>;
    `);
    const overriddenProtection = runNoreferrerRequiredRule(`
      const base = { href: "https://example.com", target: "_blank", rel: "noreferrer" };
      const unsafeProps = { ...base, ...{ rel: "" } };
      const Link = () => <a {...unsafeProps}>Example</a>;
    `);
    const knownAfterUnknown = runNoreferrerRequiredRule(`
      const props = { ...unknownProps, href: "https://example.com", target: "_blank", rel: "" };
      const Link = () => <a {...props}>Example</a>;
    `);

    expect(protectedLink.diagnostics).toHaveLength(0);
    expect(overriddenProtection.diagnostics).toHaveLength(1);
    expect(knownAfterUnknown.diagnostics).toHaveLength(1);
  });

  it("keeps genuinely unknown spreads quiet unless later attributes prove the finding", () => {
    const uncertain = runNoreferrerRequiredRule(
      'const Link = ({ props }) => <a href="https://example.com" target="_blank" {...props}>Example</a>;',
    );
    const authoritative = runNoreferrerRequiredRule(
      'const Link = ({ props }) => <a {...props} href="https://example.com" target="_blank" rel="">Example</a>;',
    );

    expect(uncertain.diagnostics).toHaveLength(0);
    expect(authoritative.diagnostics).toHaveLength(1);
  });

  it("honors valueless attribute overrides in source order", () => {
    const targetReset = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" target>Example</a>;',
    );
    const destinationReset = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" href target="_blank">Example</a>;',
    );
    const relReset = runNoreferrerRequiredRule(
      'const Link = () => <a href="https://example.com" target="_blank" rel="noreferrer" rel>Example</a>;',
    );

    expect(targetReset.diagnostics).toHaveLength(0);
    expect(destinationReset.diagnostics).toHaveLength(0);
    expect(relReset.diagnostics).toHaveLength(1);
  });

  it("does not confuse a configured component with a lexically shadowed intrinsic alias", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `import { Link as RouterLink } from "router";
      const Outer = () => <RouterLink to="https://example.com" target="_blank" />;
      const Inner = () => {
        const RouterLink = "button";
        return <RouterLink to="https://example.com" target="_blank" />;
      };`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
          },
          react: {
            linkComponents: [{ name: "RouterLink", linkAttribute: "to" }],
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses only destinations configured for each element role", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Elements = () => <>
        <a href="/docs" action="https://example.com" target="_blank" />
        <form action="/save" href="https://example.com" target="_blank" />
        <Link to="/docs" submitTo="https://example.com" target="_blank" />
        <Form submitTo="/save" to="https://example.com" target="_blank" />
      </>;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { forms: true },
          },
          react: {
            formComponents: [{ name: "Form", formAttribute: "submitTo" }],
            linkComponents: [{ name: "Link", linkAttribute: "to" }],
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let irrelevant destinations suppress relevant external destinations", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Elements = () => <>
        <a href="https://example.com" action="/save" target="_blank" />
        <form action="https://example.com" href="/docs" target="_blank" />
        <Link to="https://example.com" submitTo="/save" target="_blank" />
        <Form submitTo="https://example.com" to="/docs" target="_blank" />
      </>;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { forms: true },
          },
          react: {
            formComponents: [{ name: "Form", formAttribute: "submitTo" }],
            linkComponents: [{ name: "Link", linkAttribute: "to" }],
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(4);
  });

  it("checks every independently configured destination for a component with both roles", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Elements = () => <>
        <Hybrid to="https://example.com" submitTo="/save" target="_blank" />
        <Hybrid to="/docs" submitTo="https://example.com" target="_blank" />
        <Hybrid to="/docs" submitTo="/save" target="_blank" />
      </>;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { forms: true },
          },
          react: {
            formComponents: [{ name: "Hybrid", formAttribute: "submitTo" }],
            linkComponents: [{ name: "Hybrid", linkAttribute: "to" }],
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("aligns equivalent negated target and rel predicates", () => {
    const result = runNoreferrerRequiredRule(`
      const isExternal = getIsExternal();
      const isInternal = !isExternal;
      const Links = ({ href }) => <>
        <a href={href} target={!isExternal ? undefined : "_blank"} rel={isExternal ? "noreferrer" : undefined} />
        <a href={href} target={isExternal ? "_blank" : undefined} rel={!isExternal ? undefined : "noreferrer"} />
        <a href={href} target={isInternal ? undefined : "_blank"} rel={isExternal ? "noreferrer" : undefined} />
        <a href={href} target={!!isExternal ? "_blank" : undefined} rel={isExternal ? "noreferrer" : undefined} />
      </>;
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports misaligned negated predicates and does not align shadowed names", () => {
    const result = runNoreferrerRequiredRule(`
      const isExternal = getIsExternal();
      const unsafeTarget = !isExternal ? "_blank" : undefined;
      const Unsafe = ({ href }) => (
        <a href={href} target={unsafeTarget} rel={isExternal ? "noreferrer" : undefined} />
      );
      const outerCondition = getCondition();
      const shadowedTarget = outerCondition ? "_blank" : undefined;
      const Shadowed = ({ href }) => {
        const outerCondition = getOtherCondition();
        const shadowedRel = outerCondition ? "noreferrer" : undefined;
        return <a href={href} target={shadowedTarget} rel={shadowedRel} />;
      };
    `);

    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not align a predicate binding that can change between target and rel evaluation", () => {
    const result = runNoreferrerRequiredRule(`
      const Link = ({ href, isExternal }) => {
        const target = isExternal ? "_blank" : undefined;
        isExternal = !isExternal;
        const rel = isExternal ? "noreferrer" : undefined;
        return <a href={href} target={target} rel={rel} />;
      };
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("clears spread warnings only when a later target proves the link cannot open a new tab", () => {
    const result = runRule(
      jsxNoTargetBlank,
      `const Links = ({ props, destination, isSelf }) => <>
        <a {...props} target="_self" />
        <a {...props} target={null} />
        <a {...props} target={isSelf ? "_self" : undefined} />
        <a target="_self" {...props} />
        <a {...props} target={destination} />
      </>;`,
      {
        settings: {
          "react-doctor": {
            capabilities: ["target-blank-needs-explicit-protection"],
            jsxNoTargetBlank: { warnOnSpreadAttributes: true },
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("describes an unprotected rel value accurately", () => {
    const result = runLegacyChromiumRule(
      '<a href="https://example.com" target="_blank" rel="external">Example</a>',
    );

    expect(result.diagnostics[0]?.message).toContain("without `noopener` or `noreferrer` in `rel`");
  });
});
