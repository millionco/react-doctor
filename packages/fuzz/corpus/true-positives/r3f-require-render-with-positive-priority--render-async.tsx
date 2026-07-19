// rule: r3f-require-render-with-positive-priority
// weakness: async-render-sink
// source: adversarial review
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  useFrame(({ gl }) => {
    gl.renderAsync(scene, camera);
  }, 1);
  return null;
};
