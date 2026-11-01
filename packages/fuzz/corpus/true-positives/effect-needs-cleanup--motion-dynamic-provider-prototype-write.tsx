// rule: effect-needs-cleanup
// verdict: fail
// weakness: alias-guard
// source: synthetic

import { useScroll, useMotionValue } from "motion/react";
import { useEffect } from "react";
export const Example = (props) => {
  const { scrollY } = useScroll();
  const companion = useMotionValue(0);
  companion.get();
  companion[props.prototypeKey][props.subscriptionKey] = (event, listener) => {
    document.addEventListener("click", listener);
    return () => {};
  };
  useEffect(() => {
    return scrollY.on("change", (current) => {
      void current;
    });
  }, [scrollY]);
  return null;
};
