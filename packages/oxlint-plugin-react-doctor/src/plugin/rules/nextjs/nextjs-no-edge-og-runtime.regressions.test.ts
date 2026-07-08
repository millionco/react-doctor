import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoEdgeOgRuntime } from "./nextjs-no-edge-og-runtime.js";

describe("nextjs/nextjs-no-edge-og-runtime — regressions", () => {
  it("flags export const runtime = 'edge' in an opengraph-image file", () => {
    const result = runRule(nextjsNoEdgeOgRuntime, `export const runtime = "edge";`, {
      filename: "app/opengraph-image.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the edge runtime export in a twitter-image file", () => {
    const result = runRule(nextjsNoEdgeOgRuntime, `export const runtime = "edge";`, {
      filename: "app/blog/twitter-image.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on the same export in a regular page file", () => {
    const result = runRule(nextjsNoEdgeOgRuntime, `export const runtime = "edge";`, {
      filename: "app/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
