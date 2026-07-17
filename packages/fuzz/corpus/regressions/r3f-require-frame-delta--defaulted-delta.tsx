// rule: r3f-require-frame-delta
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame((_, delta = 0) => {
    mesh.current.position.x += speed * delta;
  });
};
