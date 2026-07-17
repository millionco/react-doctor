import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noExcessiveMotionStagger } from "./no-excessive-motion-stagger.js";

describe("no-excessive-motion-stagger", () => {
  it("flags a long legacy child stagger on a proven Motion element", () => {
    const result = runRule(
      noExcessiveMotionStagger,
      `import { motion } from "motion/react"; const List = () => <motion.ul transition={{ staggerChildren: 0.2 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a long modern stagger function interval", () => {
    const result = runRule(
      noExcessiveMotionStagger,
      `import { motion, stagger } from "motion/react"; const List = () => <motion.ul animate={{ opacity: 1, transition: { delayChildren: stagger(0.15) } }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a short stagger and dynamic configuration", () => {
    const result = runRule(
      noExcessiveMotionStagger,
      `import { motion, stagger } from "motion/react"; const List = ({ interval }) => <><motion.ul transition={{ staggerChildren: 0.05 }} /><motion.ol transition={{ delayChildren: stagger(interval) }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a Motion lookalike", () => {
    const result = runRule(
      noExcessiveMotionStagger,
      `const motion = { ul: "ul" }; const List = () => <motion.ul transition={{ staggerChildren: 0.2 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
