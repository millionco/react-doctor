// rule: three-require-renderer-cleanup
import { useRef } from "react";
import { WebGLRenderer } from "three";

export const Scene = () => {
  const rendererRef = useRef<WebGLRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new WebGLRenderer();
  rendererRef.current.render(scene, camera);
  return null;
};
