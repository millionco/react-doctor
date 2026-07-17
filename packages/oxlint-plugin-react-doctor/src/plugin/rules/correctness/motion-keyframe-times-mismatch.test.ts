import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionKeyframeTimesMismatch } from "./motion-keyframe-times-mismatch.js";

describe("motion-keyframe-times-mismatch", () => {
  it("reports mismatched direct and nested static transition times", () => {
    const result = runRule(
      motionKeyframeTimesMismatch,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ times: [0, 1] }} />
         <motion.div animate={{ x: [0, 20], transition: { times: [0, 0.5, 1] } }} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows matched arrays and skips dynamic or spread-backed values", () => {
    const result = runRule(
      motionKeyframeTimesMismatch,
      `import { motion } from "motion/react";
       const Demo = ({ animate, transition, rest }) => <>
         <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ times: [0, 0.5, 1] }} />
         <motion.div animate={animate} transition={transition} />
         <motion.div animate={{ opacity: [0, ...rest] }} transition={{ times: [0] }} />
         <motion.div animate={{ opacity: [0, 1], ...animate }} transition={{ times: [0] }} />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores lookalike JSX components", () => {
    const result = runRule(
      motionKeyframeTimesMismatch,
      `const motion = { div: "div" }; const Demo = () => <motion.div animate={{ opacity: [0, 1] }} transition={{ times: [0] }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
