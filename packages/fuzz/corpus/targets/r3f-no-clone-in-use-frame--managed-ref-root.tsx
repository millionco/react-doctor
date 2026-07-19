// rule: r3f-no-clone-in-use-frame
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export const Scene = () => {
  const mesh = useRef(null);
  useFrame(() => mesh.current.clone());
  return <mesh ref={mesh} />;
};
