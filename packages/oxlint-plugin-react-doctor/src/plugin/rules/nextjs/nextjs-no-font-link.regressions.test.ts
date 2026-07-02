import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoFontLink } from "./nextjs-no-font-link.js";

describe("nextjs/nextjs-no-font-link — regressions", () => {
  it("stays silent on a preconnect link that loads no fonts", () => {
    const result = runRule(
      nextjsNoFontLink,
      `export default function C() { return <link rel="preconnect" href="https://fonts.googleapis.com" />; }`,
      { filename: "app/layout.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a render-blocking stylesheet", () => {
    const result = runRule(
      nextjsNoFontLink,
      `export default function C() { return <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter" />; }`,
      { filename: "app/layout.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
