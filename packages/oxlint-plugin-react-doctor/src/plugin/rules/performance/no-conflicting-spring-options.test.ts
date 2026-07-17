import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noConflictingSpringOptions } from "./no-conflicting-spring-options.js";

describe("no-conflicting-spring-options", () => {
  it("flags physics and duration options in one spring", () => {
    const result = runRule(
      noConflictingSpringOptions,
      `import { motion } from "motion/react";
       const Card = () => <motion.div animate={{ x: 100 }} transition={{ type: "spring", stiffness: 200, damping: 20, duration: 0.4, bounce: 0.2 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a conflicting transition nested in animate", () => {
    const result = runRule(
      noConflictingSpringOptions,
      `import * as Motion from "framer-motion";
       const Card = () => <Motion.motion.div animate={{ x: 100, transition: { type: "spring", mass: 1, bounce: 0.3 } }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a physics spring", () => {
    const result = runRule(
      noConflictingSpringOptions,
      `import { motion } from "motion/react";
       const Card = () => <motion.div transition={{ type: "spring", stiffness: 200, damping: 20, mass: 1 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a duration spring", () => {
    const result = runRule(
      noConflictingSpringOptions,
      `import { motion } from "motion/react";
       const Card = () => <motion.div transition={{ type: "spring", duration: 0.4, bounce: 0.2 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips dynamic and spread-overridden transition objects", () => {
    const result = runRule(
      noConflictingSpringOptions,
      `import { motion } from "motion/react";
       const A = () => <motion.div transition={springConfig} />;
       const B = ({ props }) => <motion.div transition={{ type: "spring", stiffness: 200, duration: 0.4, ...props }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a same-shaped custom component as Motion", () => {
    const result = runRule(
      noConflictingSpringOptions,
      `const Card = () => <Panel transition={{ type: "spring", stiffness: 200, duration: 0.4 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
