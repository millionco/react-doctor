// rule: three-require-render-target-cleanup
// weakness: conditional-cleanup
// source: lifecycle audit
import { useEffect, useMemo } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = ({ enabled }) => {
  const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
  useEffect(
    () => () => {
      if (enabled) target.dispose();
    },
    [enabled, target],
  );
  return null;
};
