// rule: three-require-renderer-cleanup
// weakness: ownership
// source: handbook audit
import { WebGLRenderer } from "three";

export const Scene = ({ rendererRef }) => {
  if (!rendererRef.current) rendererRef.current = new WebGLRenderer();
  return null;
};
