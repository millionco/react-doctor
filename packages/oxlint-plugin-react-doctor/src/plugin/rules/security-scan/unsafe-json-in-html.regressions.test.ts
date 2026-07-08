import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { unsafeJsonInHtml } from "./unsafe-json-in-html.js";

const scan = (content: string, relativePath = "src/component.tsx") =>
  runScanRule(unsafeJsonInHtml, { relativePath, content });

describe("security-scan/unsafe-json-in-html — regressions", () => {
  it("stays silent when JSON.stringify is the injected script's own runtime code", () => {
    const content = `const html = \`
  <body>
    <script type="text/javascript">
      const handleSessionUpdate = (event) => {
        window.ReactNativeWebView.postMessage(JSON.stringify(event.payload.session))
      }
    </script>
  </body>
\`;
`;
    expect(scan(content)).toHaveLength(0);
  });

  it("stays silent on a React-escaped JSX text child of <script>", () => {
    const content = `export function Register({ ids }: { ids: string[] }) {
  return (
    <script>{\`window.__TableOfContents__?.register(\${JSON.stringify(ids)});\`}</script>
  );
}
`;
    expect(scan(content)).toHaveLength(0);
  });

  it("stays silent on a fully hardcoded JSON-LD literal", () => {
    const content = `export const Head = () => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Rad UI",
        "operatingSystem": "Web",
        "aggregateRating": { "@type": "AggregateRating", "ratingValue": "5", "ratingCount": 4 },
        "isAccessibleForFree": true,
      })
    }}
  />
);
`;
    expect(scan(content)).toHaveLength(0);
  });

  it("still flags stringified dynamic data interpolated into a script template", () => {
    const content = `export const buildHtml = (data: unknown) => \`
  <script>window.__DATA__ = \${JSON.stringify(data)};</script>
\`;
`;
    expect(scan(content)).toBeTruthy();
    expect(scan(content).length).toBeGreaterThan(0);
  });

  it("still flags stringified dynamic data joined by string concat", () => {
    const content = `export const buildHtml = (data: unknown) =>
  "<script>window.__DATA__ = " + JSON.stringify(data) + ";</script>";
`;
    expect(scan(content).length).toBeGreaterThan(0);
  });

  it("still flags unescaped JSON-LD built from a dynamic value", () => {
    const content = `export const Seo = ({ structuredData }: { structuredData: object }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
  />
);
`;
    expect(scan(content, "src/seo.tsx").length).toBeGreaterThan(0);
  });

  it("still flags a literal argument that mixes in identifiers", () => {
    const content = `export const Seo = ({ title }: { title: string }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify({ "@type": "Article", "headline": title })
    }}
  />
);
`;
    expect(scan(content, "src/seo.tsx").length).toBeGreaterThan(0);
  });
});
