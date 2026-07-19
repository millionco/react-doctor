// rule: three-require-renderer-cleanup
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { WebGLRenderer } from "three";

export const Scene = ({ canvas, shouldUseOwnedRenderer }) => {
  const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
  const makeRenderer = () => {
    if (shouldUseOwnedRenderer) return renderer;
    return new WebGLRenderer({ canvas });
  };
  return <Canvas gl={makeRenderer} />;
};
