// rule: no-hover-only-reveal
// weakness: dynamic-value
// source: Motion initial and animate prop contract audit
// verdict: pass

import { motion } from "motion/react";

export const ControlledAction = ({ controls }) => (
  <motion.button animate={controls} initial={{ opacity: 0 }} whileHover={{ opacity: 1 }}>
    Edit
  </motion.button>
);
