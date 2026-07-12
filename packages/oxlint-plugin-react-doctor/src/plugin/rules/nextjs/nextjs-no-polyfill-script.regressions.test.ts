import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoPolyfillScript } from "./nextjs-no-polyfill-script.js";

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(nextjsNoPolyfillScript, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("nextjs-no-polyfill-script request identity", () => {
  it("ignores polyfill text after the first URL fragment delimiter", () => {
    expectDiagnosticCount(
      `export const Page = () => <>
        <script src="/analytics.js#https://polyfill.io/v3/polyfill.min.js" />
        <script src="/analytics.js##polyfill.min.js" />
        <script src="/analytics.js#section#polyfill.min.js" />
        <script src="https://example.com/analytics.js#polyfill.min.js" />
        <script src="//example.com/analytics.js#polyfill.min.js" />
        <script src="analytics.js#polyfill.min.js" />
      </>;`,
      0,
    );
  });

  it("reports network polyfill URLs with empty or non-empty fragments", () => {
    expectDiagnosticCount(
      `export const Page = () => <>
        <script src="https://polyfill.io/v3/polyfill.min.js" />
        <script src="https://polyfill.io/v3/polyfill.min.js#" />
        <script src="https://polyfill.io/v3/polyfill.min.js#ignored" />
        <script src="HTTPS://user:secret@polyfill.io:443/v3/polyfill.min.js#ignored" />
        <script src="//polyfill.io/v3/polyfill.min.js#ignored" />
        <script src="/assets/polyfill.min.js#ignored" />
        <script src="assets/polyfill.min.js#ignored" />
      </>;`,
      7,
    );
  });

  it("keeps literal and percent-encoded request data before the fragment", () => {
    expectDiagnosticCount(
      `export const Page = () => <>
        <script src="/analytics.js?fallback=polyfill.min.js#ignored" />
        <script src="/analytics.js?fallback=%23polyfill.min.js#ignored" />
        <script src="/assets/%23polyfill.min.js#ignored" />
      </>;`,
      3,
    );
  });

  it("ignores non-network script URL schemes", () => {
    expectDiagnosticCount(
      `export const Page = () => <>
        <script src="data:text/javascript,polyfill.min.js" />
        <script src="blob:https://polyfill.io/polyfill.min.js" />
        <script src="javascript:polyfill.min.js" />
        <script src="  DATA:text/javascript,polyfill.min.js" />
      </>;`,
      0,
    );
  });

  it("ignores empty, fragment-only, and dynamic sources", () => {
    expectDiagnosticCount(
      `export const Page = ({ sourceUrl }) => <>
        <script src="" />
        <script src="#polyfill.min.js" />
        <script src={sourceUrl} />
      </>;`,
      0,
    );
  });
});
