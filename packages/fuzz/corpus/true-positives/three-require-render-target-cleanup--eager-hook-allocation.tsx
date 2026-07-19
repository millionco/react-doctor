// rule: three-require-render-target-cleanup
// weakness: eager-hook-allocation
// source: lifecycle audit
import { useEffect, useRef } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = () => {
  const targetRef = useRef(new WebGLRenderTarget(1, 1));
  useEffect(() => () => targetRef.current.dispose(), []);
  return null;
};
