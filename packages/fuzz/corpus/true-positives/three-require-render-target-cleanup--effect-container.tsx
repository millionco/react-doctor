// rule: three-require-render-target-cleanup
// weakness: invalid-effect-cleanup-shape
// source: lifecycle audit
import { useEffect, useMemo } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = () => {
  const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
  useEffect(() => [() => target.dispose()], [target]);
  return null;
};
