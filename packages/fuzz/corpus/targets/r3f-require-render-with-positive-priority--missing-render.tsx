// rule: r3f-require-render-with-positive-priority
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame(() => update(), 1);
  return null;
};
