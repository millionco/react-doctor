// rule: prefer-motion-transform-property
// weakness: static-value-semantics
// source: Motion initial prop documentation
// verdict: pass

import { motion } from "motion/react";

export const PositionedCard = () => (
  <motion.article initial={{ x: 20, scale: 0.98 }} animate={{ opacity: 1 }} />
);
