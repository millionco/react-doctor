// rule: r3f-no-fresh-use-three-selector
import { useThree } from "@react-three/fiber";

export const Scene = ({ prototype }) => {
  useThree((state) => Object.create(prototype));
  return null;
};
