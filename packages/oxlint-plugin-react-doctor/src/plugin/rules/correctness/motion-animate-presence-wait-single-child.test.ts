import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionAnimatePresenceWaitSingleChild } from "./motion-animate-presence-wait-single-child.js";

describe("motion-animate-presence-wait-single-child", () => {
  it("reports multiple static children in wait mode", () => {
    const result = runRule(
      motionAnimatePresenceWaitSingleChild,
      `import { AnimatePresence } from "motion/react";
       const Stack = () => <AnimatePresence mode="wait"><Panel key="a" /><Panel key="b" /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports namespace imports and brace-wrapped literals", () => {
    const result = runRule(
      motionAnimatePresenceWaitSingleChild,
      `import * as Motion from "framer-motion";
       const Stack = () => <Motion.AnimatePresence mode={"wait"}><div key="a" /><div key="b" /></Motion.AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows one static child in wait mode", () => {
    const result = runRule(
      motionAnimatePresenceWaitSingleChild,
      `import { AnimatePresence } from "motion/react";
       const Stack = () => <AnimatePresence mode="wait"><Panel key="a" /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows multiple children in sync and popLayout modes", () => {
    const result = runRule(
      motionAnimatePresenceWaitSingleChild,
      `import { AnimatePresence } from "motion/react";
       const A = () => <AnimatePresence mode="sync"><Panel key="a" /><Panel key="b" /></AnimatePresence>;
       const B = () => <AnimatePresence mode="popLayout"><Panel key="a" /><Panel key="b" /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic modes and trailing spreads", () => {
    const result = runRule(
      motionAnimatePresenceWaitSingleChild,
      `import { AnimatePresence } from "motion/react";
       const A = ({ mode }) => <AnimatePresence mode={mode}><Panel /><Panel /></AnimatePresence>;
       const B = ({ props }) => <AnimatePresence mode="wait" {...props}><Panel /><Panel /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
