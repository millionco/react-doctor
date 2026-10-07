// rule: no-mixed-animation-owners
// weakness: control-flow
// source: adversarial audit of deterministic design rules
// verdict: pass

import { motion } from "motion/react";

export const MotionOwnership = () => (
  <>
    <motion.div animate={{ opacity: 1 }} className={false ? "transition-opacity" : ""} />
    <motion.div animate={{ opacity: 1 }} className="motion-safe:motion-reduce:transition-opacity" />
    <motion.div
      animate={{ opacity: 1 }}
      className="transition-opacity motion-safe:transition-none motion-reduce:transition-none"
    />
  </>
);
