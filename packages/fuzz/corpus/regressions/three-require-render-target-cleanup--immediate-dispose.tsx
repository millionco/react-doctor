// rule: three-require-render-target-cleanup
// weakness: control-flow
// source: RDE pmndrs/drei@c9d3d0dc src/core/Preload.tsx
import { useEffect } from "react";
import { WebGLCubeRenderTarget } from "three";

export const Preload = ({ camera, gl, scene }) => {
  useEffect(() => {
    const target = new WebGLCubeRenderTarget(128);
    camera.update(gl, scene, target);
    target.dispose();
  }, []);
  return null;
};
