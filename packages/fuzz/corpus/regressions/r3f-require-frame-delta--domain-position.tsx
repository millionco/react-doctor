// rule: r3f-require-frame-delta
import { useFrame } from "@react-three/fiber";

export const Scene = ({ ringBuffer }) => {
  useFrame(() => {
    ringBuffer.position += 1;
    ringBuffer.rotation.y++;
  });
  return null;
};
