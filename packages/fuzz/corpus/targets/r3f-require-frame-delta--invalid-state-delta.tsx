// rule: r3f-require-frame-delta
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame((state) => {
    mesh.current.position.x += speed * state.delta;
  });
};
