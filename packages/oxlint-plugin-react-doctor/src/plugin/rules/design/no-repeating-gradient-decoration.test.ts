import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatingGradientDecoration } from "./no-repeating-gradient-decoration.js";

describe("no-repeating-gradient-decoration", () => {
  it("flags an inline repeating gradient", () => {
    const result = runRule(
      noRepeatingGradientDecoration,
      `const Panel = () => <div style={{ backgroundImage: "repeating-linear-gradient(45deg, #fff 0 4px, #eee 4px 8px)" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arbitrary Tailwind repeating gradient", () => {
    const result = runRule(
      noRepeatingGradientDecoration,
      `const Panel = () => <div className="[background-image:repeating-radial-gradient(circle,#fff_0_2px,#eee_2px_4px)]" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a single nonrepeating gradient", () => {
    const result = runRule(
      noRepeatingGradientDecoration,
      `const Panel = () => <div style={{ backgroundImage: "linear-gradient(#fff, #eee)" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
