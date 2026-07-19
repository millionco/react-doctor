// rule: r3f-no-clone-in-use-frame
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export const Scene = () => {
  const snapshot = useRef({ position: { clone: () => ({}) } });
  useFrame(() => snapshot.current.position.clone());
  return null;
};
