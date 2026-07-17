// rule: r3f-no-use-frame-dependency-array
// source: pmndrs React Three Fiber examples and official useFrame scheduling contract
import { useFrame } from "@react-three/fiber";

export const ArrayPriorityScene = () => {
  useFrame(() => updateScene(), []);
  return null;
};
