import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsInlineScriptMissingId } from "./nextjs-inline-script-missing-id.js";

describe("nextjs/nextjs-inline-script-missing-id — regressions", () => {
  it("stays silent when attributes are forwarded via spread", () => {
    const result = runRule(
      nextjsInlineScriptMissingId,
      `function ScriptWrapper(props) { return <Script {...props} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a literal inline Script with no id", () => {
    const result = runRule(
      nextjsInlineScriptMissingId,
      `const C = () => <Script>{"console.log(1)"}</Script>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
