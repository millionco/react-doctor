import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { webAnimationOffsetsValid } from "./web-animation-offsets-valid.js";

describe("web-animation-offsets-valid", () => {
  it("reports out-of-range offsets in array-form keyframes", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `document.querySelector(".panel").animate([
        { opacity: 0, offset: -0.1 },
        { opacity: 0.5, offset: 0.5 },
        { opacity: 1, offset: 1.1 },
      ]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every(({ message }) => message.includes("between 0 and 1"))).toBe(
      true,
    );
  });

  it("reports descending offsets in array-form keyframes", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `document.body.animate([
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(50px)", offset: 0.8 },
        { transform: "translateX(75px)" },
        { transform: "translateX(100px)", offset: 0.4 },
      ]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("nondecreasing");
  });

  it("reports invalid property-indexed offset arrays", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `document.documentElement.animate({
        opacity: [0, 0.5, 0.75, 1],
        offset: [0, 0.7, 0.3, 1.2],
      });`,
    );
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].message).toContain("nondecreasing");
    expect(result.diagnostics[1].message).toContain("between 0 and 1");
  });

  it("accepts equal, null, and missing offsets", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `document.body.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0.25, offset: null },
        { opacity: 0.5 },
        { opacity: 0.75, offset: 0.5 },
        { opacity: 0.9, offset: 0.5 },
        { opacity: 1, offset: 1 },
      ]);
      document.body.animate({ opacity: [0, 0.5, 1], offset: [0, null, 1] });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("proves aliased and locally wrapped DOM receivers", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `const panel = document.querySelector(".panel");
      const getPanel = () => document.getElementById("panel");
      panel.animate([{ offset: 0.8 }, { offset: 0.2 }]);
      getPanel().animate({ opacity: [0, 1], offset: [-0.2, 1] });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("uses the final authoritative offset property", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `document.body.animate([
        { opacity: 0, offset: 2, offset: 0 },
        { opacity: 1, offset: 1, offset: 1.5 },
      ]);
      document.body.animate({ opacity: [0, 1], offset: [0, 2], offset: [0, 1] });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("1.5");
  });

  it("skips dynamic and spread-backed offsets", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `const run = (offset, keyframes, rest, offsets) => {
        document.body.animate([{ offset }, { offset: 0 }]);
        document.body.animate([{ offset: 2, ...rest }, { offset: 0 }]);
        document.body.animate([{ ...rest, offset: 2 }, { offset: 0 }]);
        document.body.animate([{ offset: 0 }, ...keyframes, { offset: -1 }]);
        document.body.animate({ opacity: [0, 1], offset: [0, ...offsets] });
        document.body.animate({ opacity: [0, 1], offset });
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores userland animate methods and shadowed DOM globals", () => {
    const result = runRule(
      webAnimationOffsetsValid,
      `chart.animate([{ offset: 0.8 }, { offset: 0.2 }]);
      const demo = (document) => {
        document.body.animate({ offset: [0.8, 0.2] });
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
