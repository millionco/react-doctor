// rule: r3f-no-fresh-use-three-selector
import { useThree } from "@react-three/fiber";

export const Scene = () =>
  useThree((state) => {
    items.map((item) => {
      return { item };
    });
    return state.camera;
  });
