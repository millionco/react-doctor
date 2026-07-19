// rule: r3f-require-instanced-buffer-update
import "@react-three/fiber";
import { useRef } from "react";

export const Instances = () => {
  const meshRef = useRef(null);
  const update = () => {
    meshRef.current.setMatrixAt(0, matrix);
  };
  return <instancedMesh ref={meshRef} />;
};
