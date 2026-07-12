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
  it("ignores polyfill text in a URL fragment", () => {
    expectDiagnosticCount("/analytics.js#https://polyfill.io/v3/polyfill.min.js", 0);
  });

  it("reports a polyfill URL with or without a fragment", () => {
    expectDiagnosticCount("https://polyfill.io/v3/polyfill.min.js", 1);
    expectDiagnosticCount("https://polyfill.io/v3/polyfill.min.js#ignored", 1);
  });

  it("keeps query text because it is sent in the request", () => {
    expectDiagnosticCount("/analytics.js?fallback=polyfill.min.js", 1);
  });
});
