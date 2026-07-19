// rule: three-require-render-target-cleanup
// weakness: effect-ownership
// source: lifecycle audit
import { useMemo } from "react";
import { WebGLRenderTarget } from "three";

export const useRenderTarget = () => {
  const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
  return () => target.dispose();
};
