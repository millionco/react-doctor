import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { dangerousHtmlSink } from "../security-scan/dangerous-html-sink.js";
import { unsafeJsonInHtml } from "../security-scan/unsafe-json-in-html.js";
import { noDanger } from "./no-danger.js";

// `no-danger` is the absolutist oxc port: it flags EVERY
// `dangerouslySetInnerHTML` with zero content awareness. It is shipped
// default-off so the content-aware Security detectors — `dangerous-html-sink`
// (dynamic/tainted markup) and `unsafe-json-in-html` (the JSON-breakout case) —
// are the canonical default-on rules. These regressions pin that contract:
// the canonical-safe idioms stay clean by default, while genuinely-risky markup
// is still caught.

// Asserts both default-on `dangerouslySetInnerHTML` detectors stay silent — the
// contract that lets `no-danger` ship default-off without re-flagging safe code.
const expectDefaultDetectorsSilent = (content: string): void => {
  const file = { relativePath: "src/component.tsx", content };
  expect(runScanRule(dangerousHtmlSink, file)).toHaveLength(0);
  expect(runScanRule(unsafeJsonInHtml, file)).toHaveLength(0);
};

describe("react-builtins/no-danger — demotion regressions", () => {
  it("ships default-off so it never blanket-flags by default", () => {
    expect(noDanger.defaultEnabled).toBe(false);
  });

  it("still flags every dangerouslySetInnerHTML when opted in", () => {
    const result = runRule(noDanger, `<div dangerouslySetInnerHTML={{ __html: "x" }} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("dangerouslySetInnerHTML — canonical-safe uses stay clean by default", () => {
  it("stays silent on a theme-init <script> (static template, no interpolation)", () => {
    const content = `export const ThemeScript = () => (
  <script
    dangerouslySetInnerHTML={{
      __html: \`(function(){try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=t||'system';}catch(e){}})()\`,
    }}
  />
);
`;
    expectDefaultDetectorsSilent(content);
  });

  it("stays silent on CSS-variable injection via <style>", () => {
    const content = `export const Brand = ({ brandColor }: { brandColor: string }) => (
  <style dangerouslySetInnerHTML={{ __html: \`:root{--brand:\${brandColor}}\` }} />
);
`;
    expectDefaultDetectorsSilent(content);
  });

  it("stays silent on a sanitized (DOMPurify) value", () => {
    const content = `export const Bio = ({ userBio }: { userBio: string }) => (
  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userBio) }} />
);
`;
    expectDefaultDetectorsSilent(content);
  });

  it("stays silent on JSON-LD whose JSON is HTML-escaped at the sink", () => {
    const content = `export const Seo = ({ jsonLd }: { jsonLd: object }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\\\u003c") }}
  />
);
`;
    expectDefaultDetectorsSilent(content);
  });
});

describe("dangerouslySetInnerHTML — genuinely-risky markup is still caught", () => {
  it("flags unescaped JSON-LD via the precise unsafe-json-in-html rule", () => {
    const content = `export const Seo = ({ structuredData }: { structuredData: object }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
  />
);
`;
    expect(
      runScanRule(unsafeJsonInHtml, { relativePath: "src/seo.tsx", content }).length,
    ).toBeGreaterThan(0);
  });

  it("flags HTML built from a dynamic prop value", () => {
    const content = `export const Article = ({ userHtml }: { userHtml: string }) => (
  <div dangerouslySetInnerHTML={{ __html: userHtml }} />
);
`;
    expect(
      runScanRule(dangerousHtmlSink, { relativePath: "src/article.tsx", content }).length,
    ).toBeGreaterThan(0);
  });
});
