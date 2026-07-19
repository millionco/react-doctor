// rule: three-require-renderer-cleanup
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { WebGLRenderer } from "three";

export const Scene = ({ canvas }) => {
  const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
  return <Canvas gl={{ canvas: renderer.domElement }} />;
};
