// rule: r3f-no-clone-in-use-frame
// source: React Three Fiber per-frame allocation anti-pattern
import { useFrame } from "@react-three/fiber";

export const CloneScene = () => {
  useFrame(({ camera }) => camera.position.clone());
  return null;
};
