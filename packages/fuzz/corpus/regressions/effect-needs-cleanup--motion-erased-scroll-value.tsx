// rule: effect-needs-cleanup
// verdict: pass
// weakness: name-heuristic
// source: synthetic

import { useScroll } from "motion/react";
import { useEffect } from "react";
export const Example = (props) => {
  const { scrollY } = useScroll();
  interface scrollY {}
  useEffect(() => {
    return scrollY.on("change", (current) => {
      void current;
    });
  }, [scrollY]);
  return null;
};
