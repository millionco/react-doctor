import { AnimatePresence, motion } from "motion/react";

export const Legend = ({ visible, page }: { visible: boolean; page: number }) => (
  <AnimatePresence>
    {visible && (
      <motion.section exit={{ opacity: 0 }}>
        <AnimatePresence>
          <motion.div key={page} exit={{ x: -10 }} />
        </AnimatePresence>
      </motion.section>
    )}
  </AnimatePresence>
);
