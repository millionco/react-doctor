// rule: r3f-no-clone-in-use-frame
// weakness: control-flow
// source: Cursor Bugbot review of PR #1371
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export const Scene = ({ didResize }) => {
  const meshRef = useRef(null);
  useFrame(() => {
    if (didResize) meshRef.current.geometry.clone();
  });
  return <mesh ref={meshRef} />;
};
