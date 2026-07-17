// rule: r3f-no-clone-in-use-frame
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame((state = fallbackState) => {
    state.camera.position.clone();
  });
};
