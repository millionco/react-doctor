// rule: r3f-require-instanced-buffer-update
// weakness: control-flow
// source: RDE pmndrs/drei@c9d3d0dc src/core/Cloud.tsx
import "@react-three/fiber";
import { useRef } from "react";

export const Cloud = ({ color }) => {
  const instanceRef = useRef(null);
  const update = () => {
    instanceRef.current.setColorAt(0, color);
    if (instanceRef.current.instanceColor) {
      instanceRef.current.instanceColor.needsUpdate = true;
    }
  };
  update();
  return <instancedMesh ref={instanceRef} />;
};
