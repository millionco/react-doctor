// rule: r3f-require-frame-delta
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame(({ scene }, delta = 0) => {
    scene.position.x += speed * delta;
  });
};
