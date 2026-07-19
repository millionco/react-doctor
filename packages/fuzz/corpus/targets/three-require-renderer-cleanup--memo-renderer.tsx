// rule: three-require-renderer-cleanup
import { useMemo } from "react";
import { WebGLRenderer } from "three";

export const Scene = ({ canvas }) => {
  const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
  renderer.render(scene, camera);
  return null;
};
