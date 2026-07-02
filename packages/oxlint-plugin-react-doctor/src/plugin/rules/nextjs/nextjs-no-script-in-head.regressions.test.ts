import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoScriptInHead } from "./nextjs-no-script-in-head.js";

describe("nextjs/nextjs-no-script-in-head — regressions", () => {
  it("stays silent on a Script passed as a prop of Head", () => {
    const result = runRule(
      nextjsNoScriptInHead,
      `export default function C() { return <Head title={<Script src="https://x.js" />}>content</Head>; }`,
      { filename: "pages/index.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a Script nested as a child of Head", () => {
    const result = runRule(
      nextjsNoScriptInHead,
      `export default function C() { return <Head><Script src="https://x.js" /></Head>; }`,
      { filename: "pages/index.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
