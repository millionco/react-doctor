// rule: three-require-renderer-cleanup
// weakness: ownership-transfer
// source: Cursor Bugbot review

import { useRef } from "react";
import { WebGLRenderer } from "three";

export const Scene = ({ canvas }) => {
  const rendererRef = useRef(null);
  const renderer = new WebGLRenderer({ canvas });
  rendererRef.current = renderer;
  renderer.render(scene, camera);
  return null;
};
