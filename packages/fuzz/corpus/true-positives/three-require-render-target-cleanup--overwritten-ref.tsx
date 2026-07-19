// rule: three-require-render-target-cleanup
// weakness: unstable-resource-identity
// source: lifecycle audit
import { useEffect, useRef } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = ({ borrowedTarget }) => {
  const targetRef = useRef(null);
  if (!targetRef.current) targetRef.current = new WebGLRenderTarget(1, 1);
  targetRef.current = borrowedTarget;
  useEffect(() => () => targetRef.current.dispose(), []);
  return null;
};
