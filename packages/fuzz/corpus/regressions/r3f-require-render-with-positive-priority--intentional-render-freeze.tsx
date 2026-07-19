// rule: r3f-require-render-with-positive-priority
// weakness: library-idiom
// source: Irev-Dev/cadhub@4f65c5dde449adf33f4ff312fd0a7e13058dd9d5
import { useFrame } from "@react-three/fiber";

export const DisableRender = () => {
  useFrame(() => null, 1000);
  return null;
};
