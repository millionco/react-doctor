// rule: r3f-require-global-effect-cleanup
// weakness: control-flow
// source: Daytona parity, utsuboco/r3f-perf PerfHeadless
import { addAfterEffect, addEffect } from "@react-three/fiber";
import { useEffect } from "react";

export const PerfHeadless = ({ callback, gl }) => {
  useEffect(() => {
    let disposeEffect = null;
    let disposeAfterEffect = null;
    if (!gl.info) return;
    disposeEffect = addEffect(callback);
    disposeAfterEffect = addAfterEffect(callback);
    return () => {
      disposeEffect();
      disposeAfterEffect();
    };
  }, [callback, gl]);
  return null;
};
