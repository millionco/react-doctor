// rule: three-require-render-target-cleanup
// weakness: lazy-ref-null-guard
// source: lifecycle audit
import { useRef } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = () => {
  const targetRef = useRef(null);
  if (targetRef.current === null) targetRef.current = new WebGLRenderTarget(1, 1);
  return null;
};
