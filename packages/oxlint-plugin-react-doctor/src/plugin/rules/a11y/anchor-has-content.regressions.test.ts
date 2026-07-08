import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { anchorHasContent } from "./anchor-has-content.js";

describe("a11y/anchor-has-content regressions", () => {
  it("exempts an `<a>` named via `aria-labelledby`", () => {
    const result = runRule(
      anchorHasContent,
      `const A = () => <a href="/p" aria-labelledby="lbl" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an `<a>` with no content or accessible name", () => {
    const result = runRule(anchorHasContent, `const A = () => <a href="/p" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  // An `<a {...props} />` can receive its children at runtime, so it can't
  // be proven empty and must not be flagged.
  it("exempts an `<a>` that spreads props", () => {
    const result = runRule(anchorHasContent, `const A = (props) => <a href="/p" {...props} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  // Mined ant-design FPs: bare `<a>` wrapper-trigger
  // children under /demo/ and /__tests__/ paths. The rule skips testlike files
  // entirely (0b64af58 precedent) — production shapes below still fire.
  it("skips a bare `<a>` badge trigger in a /demo/ file", () => {
    const result = runRule(
      anchorHasContent,
      `const Demo = () => (
        <Badge count={5}>
          <a href="#" className="head-example" />
        </Badge>
      );`,
      { filename: "/repo/components/config-provider/demo/direction.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips a bare `<a>` dropdown trigger in a /__tests__/ file", () => {
    const result = runRule(
      anchorHasContent,
      `const Demo = () => (
        <Dropdown menu={{ items: [] }}>
          <a />
        </Dropdown>
      );`,
      { filename: "/repo/components/dropdown/__tests__/demo.test.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an empty `<a>` in a production source file", () => {
    const result = runRule(anchorHasContent, `const Nav = () => <a href="/p" />;`, {
      filename: "/repo/src/components/nav.tsx",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("exempts an empty `<a>` template inside Trans components", () => {
    const result = runRule(
      anchorHasContent,
      `const Desc = () => (
        <Trans
          i18nKey="settings.audiomuseDesc"
          components={{
            pluginLink: (
              <a href={AUDIOMUSE_NV_PLUGIN_URL} style={{ textDecoration: 'underline' }} />
            ),
          }}
        />
      );`,
      { filename: "/repo/src/components/settings/ServersTab.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts an empty `<a>` template in a Trans components value with attributes", () => {
    const result = runRule(
      anchorHasContent,
      `const Answer = () => (
        <Trans
          i18nKey="projects.landing.faq.shoutout.answerP1"
          components={{
            link: <a href="https://mediabunny.dev/" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      );`,
      { filename: "/repo/src/routes/index.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an empty `<a>` passed as a prop of a non-Trans component", () => {
    const result = runRule(
      anchorHasContent,
      `const Card = () => <Widget slot={<a href="/p" />} />;`,
      { filename: "/repo/src/components/card.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
