// rule: effect-needs-cleanup
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { useScroll } from "motion/react";
import { useEffect } from "react";
export const Example = (props) => {
  const { scrollY } = useScroll();
  useEffect(() => {
    type EffectMarker = string;
    return scrollY.on("change", (current) => {
      void current;
    });
  }, [scrollY]);
  return null;
};
