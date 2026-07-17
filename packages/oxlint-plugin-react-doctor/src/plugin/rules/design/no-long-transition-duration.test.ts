import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLongTransitionDuration } from "./no-long-transition-duration.js";

describe("no-long-transition-duration", () => {
  it("flags a finite long transition", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ transition: "width 2s ease" }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a finite long one-shot animation", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animation: "slide 2s ease-out" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a short transition", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ transition: "opacity 0.2s" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // A looping animation is a background loop, not a transition the user
  // waits through, so a long duration is fine.
  it("does not flag a looping animation with the `infinite` keyword", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animation: "pulse 2s ease-in-out infinite" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag animationDuration with a sibling infinite iteration count", () => {
    const stringCount = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animationDuration: "2s", animationIterationCount: "infinite" }} />;`,
    );
    const infinityCount = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animationDuration: "2s", animationIterationCount: Infinity }} />;`,
    );
    expect(stringCount.diagnostics).toHaveLength(0);
    expect(infinityCount.diagnostics).toHaveLength(0);
  });

  it("flags a long static Motion transition", () => {
    const result = runRule(
      noLongTransitionDuration,
      `import { motion } from "motion/react"; const Panel = () => <motion.div animate={{ opacity: 1 }} transition={{ duration: 1.5 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a long Motion transition nested in an animation target", () => {
    const result = runRule(
      noLongTransitionDuration,
      `import { motion } from "framer-motion"; const Panel = () => <motion.div animate={{ opacity: 1, transition: { duration: 2 } }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a duration that a physics spring ignores", () => {
    const result = runRule(
      noLongTransitionDuration,
      `import { motion } from "motion/react"; const Panel = () => <motion.div animate={{ opacity: 1 }} transition={{ type: "spring", stiffness: 100, damping: 30, duration: 1.6 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts short, looping, dynamic, decorative, and non-Motion transitions", () => {
    const result = runRule(
      noLongTransitionDuration,
      `import { motion } from "motion/react";
       const A = () => <motion.div transition={{ duration: 0.4 }} />;
       const B = () => <motion.div transition={{ duration: 2, repeat: Infinity }} />;
       const C = () => <motion.div transition={config} />;
       const D = () => <motion.div aria-hidden="true" transition={{ duration: 4 }} />;
       const E = () => <Panel transition={{ duration: 4 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
