// rule: r3f-require-frame-delta
// weakness: control-flow
// source: PR review regression
import { useFrame } from "@react-three/fiber";

export const GuardedTransform = () => {
  useFrame(({ scene }) => {
    if (didStart) scene.position.x += 0.1;
    if (didFinish) scene.rotation.y++;
  });
  return null;
};
