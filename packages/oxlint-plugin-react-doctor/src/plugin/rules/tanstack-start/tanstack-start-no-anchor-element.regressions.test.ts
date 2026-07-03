import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoAnchorElement } from "./tanstack-start-no-anchor-element.js";

const ROUTE = { filename: "src/routes/index.tsx" };

describe("tanstack-start/tanstack-start-no-anchor-element — regressions", () => {
  it("stays silent on a download link", () => {
    const { diagnostics } = runRule(
      tanstackStartNoAnchorElement,
      `const C = () => <a href="/resume.pdf" download>Download</a>;`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a protocol-relative external URL", () => {
    const { diagnostics } = runRule(
      tanstackStartNoAnchorElement,
      `const C = () => <a href="//cdn.example.com/asset">CDN</a>;`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on API and static-asset paths", () => {
    expect(
      runRule(tanstackStartNoAnchorElement, `const C = () => <a href="/api/export">x</a>;`, ROUTE)
        .diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(tanstackStartNoAnchorElement, `const C = () => <a href="/sitemap.xml">x</a>;`, ROUTE)
        .diagnostics,
    ).toHaveLength(0);
  });

  it("stays silent on a new-tab link", () => {
    const { diagnostics } = runRule(
      tanstackStartNoAnchorElement,
      `const C = () => <a href="/docs" target="_blank">Docs</a>;`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags an internal route anchor", () => {
    const { diagnostics } = runRule(
      tanstackStartNoAnchorElement,
      `const C = () => <a href="/dashboard">Go</a>;`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent outside the routes directory", () => {
    const { diagnostics } = runRule(
      tanstackStartNoAnchorElement,
      `const C = () => <a href="/dashboard">Go</a>;`,
      { filename: "src/components/nav.tsx" },
    );
    expect(diagnostics).toHaveLength(0);
  });
});
