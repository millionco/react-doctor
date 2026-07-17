import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noOverwideTextMeasure } from "./no-overwide-text-measure.js";

describe("no-overwide-text-measure", () => {
  it("flags an explicit inline measure above 80ch", () => {
    const result = runRule(
      noOverwideTextMeasure,
      `const Example = () => <p style={{ maxWidth: "96ch" }}>Copy</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arbitrary Tailwind character measure", () => {
    const result = runRule(
      noOverwideTextMeasure,
      `const Example = () => <blockquote className="max-w-[90ch]">Copy</blockquote>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a readable text measure", () => {
    const result = runRule(
      noOverwideTextMeasure,
      `const Example = () => <p className="max-w-[68ch]" style={{ width: "65ch" }}>Copy</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply body-copy limits to code", () => {
    const result = runRule(
      noOverwideTextMeasure,
      `const Example = () => <pre style={{ width: "120ch" }}>code</pre>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
