// rule: effect-needs-cleanup
// verdict: fail
// weakness: name-heuristic
// source: synthetic

import { useScroll } from "motion/react";
import { useEffect } from "react";
export const Example = (props) => {
  const { scrollY } = useScroll();
  interface useEffect {}
  useEffect(() => {
    scrollY.on("change", (current) => {
      void current;
    });
  }, [scrollY]);
  return null;
};
