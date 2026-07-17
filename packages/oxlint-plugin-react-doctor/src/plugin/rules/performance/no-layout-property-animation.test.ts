import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLayoutPropertyAnimation } from "./no-layout-property-animation.js";

describe("no-layout-property-animation", () => {
  it("flags `motion.div` animating width", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div animate={{ width: 200 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"width"');
  });

  it("flags `motion.div` animating left via whileHover", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div whileHover={{ left: 10 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"left"');
  });

  it("flags `m.span` with margin in initial", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <m.span initial={{ margin: 8 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"margin"');
  });

  it("flags a `Motion*`-named component animating height", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <MotionBox exit={{ height: 0 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"height"');
  });

  it("flags each layout key in the same animation object", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div animate={{ width: 100, height: 50, opacity: 1 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a string-literal layout key", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div animate={{ "paddingTop": 12 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `motion.div` animating transform and opacity", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div animate={{ x: 100, scale: 1.2, opacity: 0.5 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain DOM element with an animate prop", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <div animate={{ width: 200 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-motion custom component with an animate prop", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <Card animate={{ height: 50 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the `layout` prop fix shape", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div layout animate={{ opacity: 1 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-object animation value", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div animate={variants} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not expand the rule to min/max size animations", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `const X = () => <motion.div animate={{ minHeight: 0, maxHeight: 200, minWidth: 0, maxWidth: 200 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags layout properties in Web Animations keyframes", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `document.querySelector(".panel").animate([{ width: "0px" }, { width: "200px", "margin-left": "8px" }], 300);`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags property-indexed Web Animations keyframes", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `document.getElementById("panel").animate({ height: ["0px", "100px"] }, 300);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts compositor-only Web Animations keyframes", () => {
    const result = runRule(
      noLayoutPropertyAnimation,
      `document.querySelector(".panel").animate([{ transform: "scale(.8)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], 300);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an unproven application method also named animate", () => {
    const result = runRule(noLayoutPropertyAnimation, `chart.animate([{ width: 100 }]);`);
    expect(result.diagnostics).toEqual([]);
  });
});
