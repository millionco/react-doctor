import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionAnimatePresenceMustOutliveChild } from "./motion-animate-presence-must-outlive-child.js";

describe("motion-animate-presence-must-outlive-child", () => {
  it("reports presence boundaries removed by logical and conditional expressions", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const Panel = ({ open, other }) => <>
         {open && <AnimatePresence><motion.div exit={{ opacity: 0 }} /></AnimatePresence>}
         {other ? <AnimatePresence><motion.aside exit={{ x: 10 }} /></AnimatePresence> : null}
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports exit children returned by rendered collection callbacks", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const Panel = ({ open, items }) => open && (
         <AnimatePresence>
           {items.map((item) => <motion.div key={item.id} exit={{ opacity: 0 }} />)}
         </AnimatePresence>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a stable boundary around conditional children", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "framer-motion";
       const Panel = ({ open }) => (
         <AnimatePresence>{open && <motion.div exit={{ opacity: 0 }} />}</AnimatePresence>
       );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows a nested boundary when the outer boundary owns the mount condition", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const Legend = ({ visible, page }) => (
         <AnimatePresence>
           {visible && (
             <motion.section exit={{ opacity: 0 }}>
               <AnimatePresence>
                 <motion.div key={page} exit={{ x: -10 }} />
               </AnimatePresence>
             </motion.section>
           )}
         </AnimatePresence>
       );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a nested boundary whose mount condition is below the outer boundary", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const Legend = ({ visible }) => (
         <AnimatePresence>
           <motion.section>
             {visible && <AnimatePresence><motion.div exit={{ x: -10 }} /></AnimatePresence>}
           </motion.section>
         </AnimatePresence>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores boundaries without exit behavior, propagated nested boundaries, and userland lookalikes", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const A = ({ open }) => open && <AnimatePresence><motion.div animate={{ opacity: 1 }} /></AnimatePresence>;
       const B = ({ open }) => <AnimatePresence>{open && <motion.section exit={{ opacity: 0 }}><AnimatePresence propagate><motion.div exit={{ opacity: 0 }} /></AnimatePresence></motion.section>}</AnimatePresence>;
       const AnimatePresenceLocal = ({ children }) => children;
       const C = ({ open }) => open && <AnimatePresenceLocal><div exit={{ opacity: 0 }} /></AnimatePresenceLocal>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports propagate without an owning outer boundary", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const Panel = ({ open }) => open && <AnimatePresence propagate><motion.div exit={{ opacity: 0 }} /></AnimatePresence>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores exit elements returned by nested callbacks that are not rendered children", () => {
    const result = runRule(
      motionAnimatePresenceMustOutliveChild,
      `import { AnimatePresence, motion } from "motion/react";
       const Panel = ({ open, render }) => open && (
         <AnimatePresence>{render(() => <motion.div exit={{ opacity: 0 }} />)}</AnimatePresence>
       );`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
