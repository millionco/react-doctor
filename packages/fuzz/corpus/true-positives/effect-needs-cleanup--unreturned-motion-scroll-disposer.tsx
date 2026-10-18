// rule: effect-needs-cleanup
// verdict: fail
// weakness: cleanup-provenance
// source: synthetic-motion-scroll-disposer

import { useScroll } from "motion/react";
import { useEffect } from "react";
export const Example = () => {
  const { scrollY } = useScroll();
  useEffect(() => {
    scrollY.on("change", () => {});
  }, [scrollY]);
  return null;
};
