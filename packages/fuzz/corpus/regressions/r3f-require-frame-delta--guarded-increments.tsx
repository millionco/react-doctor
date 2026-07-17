// rule: r3f-require-frame-delta
// weakness: control-flow
// source: PR review regression
import { useFrame } from "@react-three/fiber";

export const GuardedTransform = () => {
  useFrame(() => {
    if (didStart) mesh.current.position.x += 0.1;
    if (didFinish) mesh.current.rotation.y++;
  });
  return null;
};
