// rule: effect-needs-cleanup
// verdict: pass
// weakness: cleanup-provenance
// source: synthetic-motion-scroll-disposer

import { useScroll } from "motion/react";
import { useEffect } from "react";
export const Example = () => {
  const { scrollY } = useScroll();
  useEffect(() => {
    return scrollY.on("change", (current) => {
      void current;
    });
  }, [scrollY]);
  return null;
};
