import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionAnimatePresenceRequiresKey } from "./motion-animate-presence-requires-key.js";

describe("motion-animate-presence-requires-key", () => {
  it("reports each unkeyed direct child", () => {
    const result = runRule(
      motionAnimatePresenceRequiresKey,
      `import { AnimatePresence } from "motion/react";
       const Stack = () => <AnimatePresence><Panel /><Panel /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports aliases and namespace imports", () => {
    const result = runRule(
      motionAnimatePresenceRequiresKey,
      `import { AnimatePresence as Presence } from "framer-motion";
       import * as Motion from "motion/react";
       const A = () => <Presence><div /><div key="b" /></Presence>;
       const B = () => <Motion.AnimatePresence><div /><div /></Motion.AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows stable keyed children", () => {
    const result = runRule(
      motionAnimatePresenceRequiresKey,
      `import { AnimatePresence } from "motion/react";
       const Stack = () => <AnimatePresence><Panel key="primary" /><Panel key="secondary" /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a single static child", () => {
    const result = runRule(
      motionAnimatePresenceRequiresKey,
      `import { AnimatePresence } from "motion/react";
       const Stack = () => <AnimatePresence><Panel /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores same-named local and type-only components", () => {
    const result = runRule(
      motionAnimatePresenceRequiresKey,
      `import type { AnimatePresence as PresenceType } from "motion/react";
       import { type AnimatePresence as InlinePresenceType } from "framer-motion";
       const AnimatePresence = ({ children }) => children;
       const Stack = () => <><AnimatePresence><Panel /><Panel /></AnimatePresence><InlinePresenceType><Panel /><Panel /></InlinePresenceType></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
