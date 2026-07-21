import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferMotionTransformProperty } from "./prefer-motion-transform-property.js";

describe("prefer-motion-transform-property", () => {
  it("flags individual Motion transform keys", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const Card = () => <motion.div animate={{ x: 100, scale: 0.95, opacity: 1 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("x, scale");
  });

  it("flags aliased and namespace Motion components", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion as animated } from "framer-motion";
       import * as Motion from "motion/react";
       const A = () => <animated.div whileHover={{ rotate: 4 }} />;
       const B = () => <Motion.motion.div exit={{ y: 20 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports one diagnostic when several targets use individual transforms", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const Card = () => <motion.div initial={{ y: 10 }} animate={{ y: 0, scale: 1 }} exit={{ scale: 0.9 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("y, scale");
  });

  it("accepts a direct transform string", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const Card = () => <motion.div animate={{ transform: "translateX(100px) scale(.95)", opacity: 1 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts opacity-only and dynamic animation values", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const A = () => <motion.div animate={{ opacity: 1 }} />;
       const B = () => <motion.div animate={variants} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts individual transforms used only as an initial visual state", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const Static = () => <motion.div initial={{ x: 100, scale: 0.95 }} />;
       const OpacityOnly = () => <motion.div initial={{ y: 20 }} animate={{ opacity: 1 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports an initial transform paired with an individual transform target", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const Card = () => <motion.div initial={{ x: 100 }} animate={{ x: 0 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips object spreads and non-Motion components", () => {
    const result = runRule(
      preferMotionTransformProperty,
      `import { motion } from "motion/react";
       const A = ({ values }) => <motion.div animate={{ x: 100, ...values }} />;
       const B = () => <Panel animate={{ x: 100 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
