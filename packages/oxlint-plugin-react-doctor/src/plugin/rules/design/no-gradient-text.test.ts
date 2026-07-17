import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGradientText } from "./no-gradient-text.js";

describe("no-gradient-text", () => {
  it.each(["bg-gradient-to-r", "bg-linear-to-r", "bg-linear-45", "bg-radial", "bg-conic"])(
    "flags gradient text using %s",
    (gradientClassName) => {
      const result = runRule(
        noGradientText,
        `const Heading = () => <h1 className="bg-clip-text ${gradientClassName} from-pink-500 to-violet-500">Title</h1>;`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("accepts a gradient background without text clipping", () => {
    const result = runRule(
      noGradientText,
      `const Banner = () => <div className="bg-linear-to-r from-blue-500 to-cyan-500">Title</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine utilities from different variants", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="bg-clip-text dark:bg-linear-to-r">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
