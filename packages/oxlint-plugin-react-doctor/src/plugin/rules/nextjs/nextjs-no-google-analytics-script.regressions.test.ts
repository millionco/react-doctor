import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoGoogleAnalyticsScript } from "./nextjs-no-google-analytics-script.js";

describe("nextjs/nextjs-no-google-analytics-script — regressions", () => {
  it("flags a hand-rolled gtag Script element", () => {
    const result = runRule(
      nextjsNoGoogleAnalyticsScript,
      `const a = <Script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on unrelated script sources", () => {
    const result = runRule(
      nextjsNoGoogleAnalyticsScript,
      `const a = <Script src="https://example.com/widget.js" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
