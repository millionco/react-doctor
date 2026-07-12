import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoPolyfillScript } from "./nextjs-no-polyfill-script.js";

const expectDiagnosticCount = (sourceUrl: string, expectedCount: number): void => {
  const result = runRule(
    nextjsNoPolyfillScript,
    `export const Page = () => <script src=${JSON.stringify(sourceUrl)} />;`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("nextjs-no-polyfill-script request identity", () => {
  it("ignores polyfill text after the first URL fragment delimiter", () => {
    for (const sourceUrl of [
      "/analytics.js#https://polyfill.io/v3/polyfill.min.js",
      "/analytics.js##polyfill.min.js",
      "/analytics.js#section#polyfill.min.js",
      "https://example.com/analytics.js#polyfill.min.js",
      "//example.com/analytics.js#polyfill.min.js",
      "analytics.js#polyfill.min.js",
    ]) {
      expectDiagnosticCount(sourceUrl, 0);
    }
  });

  it("reports network polyfill URLs with empty or non-empty fragments", () => {
    for (const sourceUrl of [
      "https://polyfill.io/v3/polyfill.min.js",
      "https://polyfill.io/v3/polyfill.min.js#",
      "https://polyfill.io/v3/polyfill.min.js#ignored",
      "HTTPS://user:secret@polyfill.io:443/v3/polyfill.min.js#ignored",
      "//polyfill.io/v3/polyfill.min.js#ignored",
      "/assets/polyfill.min.js#ignored",
      "assets/polyfill.min.js#ignored",
    ]) {
      expectDiagnosticCount(sourceUrl, 1);
    }
  });

  it("keeps literal and percent-encoded request data before the fragment", () => {
    for (const sourceUrl of [
      "/analytics.js?fallback=polyfill.min.js#ignored",
      "/analytics.js?fallback=%23polyfill.min.js#ignored",
      "/assets/%23polyfill.min.js#ignored",
    ]) {
      expectDiagnosticCount(sourceUrl, 1);
    }
  });

  it("ignores non-network script URL schemes", () => {
    for (const sourceUrl of [
      "data:text/javascript,polyfill.min.js",
      "blob:https://polyfill.io/polyfill.min.js",
      "javascript:polyfill.min.js",
      "  DATA:text/javascript,polyfill.min.js",
    ]) {
      expectDiagnosticCount(sourceUrl, 0);
    }
  });

  it("ignores empty, fragment-only, and dynamic sources", () => {
    expectDiagnosticCount("", 0);
    expectDiagnosticCount("#polyfill.min.js", 0);

    const result = runRule(
      nextjsNoPolyfillScript,
      `export const Page = ({ sourceUrl }) => <script src={sourceUrl} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
