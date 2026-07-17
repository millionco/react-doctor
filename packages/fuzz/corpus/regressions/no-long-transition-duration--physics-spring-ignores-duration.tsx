// rule: no-long-transition-duration
// weakness: library-idiom
// source: RDE better-auth/better-auth demo/nextjs

import { motion } from "motion/react";

export const PricingCard = () => (
  <motion.div
    animate={{ opacity: 1, y: 0 }}
    transition={{ type: "spring", stiffness: 100, damping: 30, duration: 1.6 }}
  />
);
