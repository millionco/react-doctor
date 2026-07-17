import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noExcessiveFontFamilies } from "./no-excessive-font-families.js";

describe("no-excessive-font-families", () => {
  it("flags four literal font families on one page", () => {
    const result = runRule(
      noExcessiveFontFamilies,
      `const Page = () => <main><h1 style={{ fontFamily: "Fraunces" }}>Title</h1><p style={{ fontFamily: "Inter" }}>Body</p><code style={{ fontFamily: "JetBrains Mono" }}>Code</code><aside style={{ fontFamily: "Caveat" }}>Note</aside></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a display, body, and monospace family", () => {
    const result = runRule(
      noExcessiveFontFamilies,
      `const Page = () => <main><h1 className="font-serif">Title</h1><p className="font-sans">Body</p><code className="font-mono">Code</code></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores tokenized font values", () => {
    const result = runRule(
      noExcessiveFontFamilies,
      `const Page = () => <main><h1 style={{ fontFamily: "var(--font-display)" }}>Title</h1><p style={{ fontFamily: "var(--font-body)" }}>Body</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count arbitrary font-weight utilities as families", () => {
    const result = runRule(
      noExcessiveFontFamilies,
      `const Page = () => <main><h1 className="font-serif">Title</h1><p className="font-sans">Body</p><code className="font-mono">Code</code><strong className="font-[700]">Strong</strong></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
