// rule: require-reduced-motion
// source: PR 1238 adversarial validation

import { motion, useReducedMotion } from "framer-motion";

export const App = () => {
  useReducedMotion();
  return <motion.div animate={{ x: 120 }}>moving</motion.div>;
};
