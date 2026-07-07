import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoVercelOgImport } from "./nextjs-no-vercel-og-import.js";

describe("nextjs/nextjs-no-vercel-og-import — regressions", () => {
  it("flags importing ImageResponse from @vercel/og", () => {
    const result = runRule(nextjsNoVercelOgImport, `import { ImageResponse } from "@vercel/og";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when importing from next/og", () => {
    const result = runRule(nextjsNoVercelOgImport, `import { ImageResponse } from "next/og";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
