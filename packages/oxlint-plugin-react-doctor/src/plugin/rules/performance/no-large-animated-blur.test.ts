import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLargeAnimatedBlur } from "./no-large-animated-blur.js";

describe("no-large-animated-blur", () => {
  it("flags a large blur in a Motion animation", () => {
    const result = runRule(
      noLargeAnimatedBlur,
      `const X = () => <motion.div animate={{ filter: "blur(24px)" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a large blur in Web Animations keyframes", () => {
    const result = runRule(
      noLargeAnimatedBlur,
      `document.querySelector(".card").animate([{ filter: "blur(20px)" }, { filter: "blur(0px)" }], 200);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a large animated backdrop blur with a CSS property name", () => {
    const result = runRule(
      noLargeAnimatedBlur,
      `document.querySelector(".card").animate([{ "backdrop-filter": "blur(20px)" }, { "backdrop-filter": "blur(0px)" }], 200);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a small animated blur", () => {
    const result = runRule(
      noLargeAnimatedBlur,
      `document.querySelector(".card").animate({ filter: "blur(8px)" }, 120);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake a static inline blur for animation", () => {
    const result = runRule(
      noLargeAnimatedBlur,
      `const X = () => <div style={{ filter: "blur(24px)" }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
