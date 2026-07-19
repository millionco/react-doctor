// rule: three-require-render-target-cleanup
import { useMemo } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = () => {
  const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
  return target.width;
};
