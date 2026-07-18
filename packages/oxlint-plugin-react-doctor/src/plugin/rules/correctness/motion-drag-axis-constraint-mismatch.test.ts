import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionDragAxisConstraintMismatch } from "./motion-drag-axis-constraint-mismatch.js";

describe("motion-drag-axis-constraint-mismatch", () => {
  it("reports constraints that cannot bound the selected drag axis", () => {
    const result = runRule(
      motionDragAxisConstraintMismatch,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div drag="x" dragConstraints={{ top: -40, bottom: 40 }} />
         <motion.div drag={"y"} dragConstraints={{ left: -80, right: 80 }} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports inverted numeric bounds from direct and stable local objects", () => {
    const result = runRule(
      motionDragAxisConstraintMismatch,
      `import { m as animated } from "framer-motion";
       const horizontalConstraints = { left: 80, right: -80 };
       let verticalConstraints = { top: 40, bottom: -40 };
       const Demo = () => <>
         <animated.div drag="x" dragConstraints={horizontalConstraints} />
         <animated.div drag="y" dragConstraints={verticalConstraints} />
         <animated.div drag="x" dragConstraints={{ left: 1, right: -1, top: -20 }} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows correct one-sided and ordered constraints", () => {
    const result = runRule(
      motionDragAxisConstraintMismatch,
      `import { motion } from "motion/react";
       const horizontalConstraints = { left: -100 };
       const Demo = () => <>
         <motion.div drag="x" dragConstraints={horizontalConstraints} />
         <motion.div drag="x" dragConstraints={{ right: 100, top: -20, bottom: 20 }} />
         <motion.div drag="y" dragConstraints={{ top: -40 }} />
         <motion.div drag="y" dragConstraints={{ top: -40, bottom: 40 }} />
         <motion.div drag dragConstraints={{ left: 20, right: -20 }} />
         <motion.div drag="x" />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips dynamic constraints, refs, spreads, computed keys, and reassigned locals", () => {
    const result = runRule(
      motionDragAxisConstraintMismatch,
      `import { motion } from "motion/react";
       import { constraints as importedConstraints } from "./constraints";
       const constraintsRef = useRef(null);
       const axis = getAxis();
       const dynamicKey = getConstraintKey();
       const rest = getConstraints();
       let reassignedConstraints = { top: -20, bottom: 20 };
       reassignedConstraints = getConstraints();
       const Demo = (props) => <>
         <motion.div drag={axis} dragConstraints={{ top: -20, bottom: 20 }} />
         <motion.div drag="x" dragConstraints={constraintsRef} />
         <motion.div drag="x" dragConstraints={importedConstraints} />
         <motion.div drag="x" dragConstraints={{ ...rest, top: -20, bottom: 20 }} />
         <motion.div drag="x" dragConstraints={{ [dynamicKey]: -20, bottom: 20 }} />
         <motion.div drag="x" dragConstraints={reassignedConstraints} />
         <motion.div drag="x" {...props} dragConstraints={{ top: -20, bottom: 20 }} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores userland motion lookalikes and shadowed aliases", () => {
    const result = runRule(
      motionDragAxisConstraintMismatch,
      `import { motion as importedMotion } from "motion/react";
       import { motion } from "./motion";
       const Demo = () => <>
         <motion.div drag="x" dragConstraints={{ top: -20, bottom: 20 }} />
         {((importedMotion) => <importedMotion.div drag="x" dragConstraints={{ top: -20 }} />)({ div: "div" })}
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
