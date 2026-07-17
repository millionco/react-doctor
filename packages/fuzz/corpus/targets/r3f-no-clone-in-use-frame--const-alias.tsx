// rule: r3f-no-clone-in-use-frame
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame(({ camera }) => {
    const position = camera.position;
    position.clone();
  });
  return null;
};
