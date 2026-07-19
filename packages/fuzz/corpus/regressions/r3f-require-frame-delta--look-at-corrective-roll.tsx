// rule: r3f-require-frame-delta
// weakness: library-idiom
// source: Daytona parity, tinacms/tina.io Globe
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export const Globe = ({ center }) => {
  const globeRef = useRef(null);
  useFrame(() => {
    if (!globeRef.current) return;
    globeRef.current.lookAt(center);
    globeRef.current.rotation.z += Math.PI / 2;
  });
  return <group ref={globeRef} />;
};
