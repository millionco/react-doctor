// rule: r3f-no-imperative-attach-of-managed-ref
// weakness: name-heuristic
// source: adversarial audit of the R3F rule candidate suite
import { useRef } from "react";
import "@react-three/fiber";

export const MeshRegistry = () => {
  const meshRef = useRef(null);
  const mountedMeshes = new Set();
  mountedMeshes.add(meshRef.current);
  return <mesh ref={meshRef} />;
};
