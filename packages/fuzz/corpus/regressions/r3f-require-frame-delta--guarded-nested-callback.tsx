// rule: r3f-require-frame-delta
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { useFrame } from "@react-three/fiber";

export const GuardedInterpolation = ({ didStart }: { didStart: boolean }) => {
  useFrame(({ camera }) => {
    if (didStart) {
      targets.forEach((target) => camera.position.lerp(target, 0.1));
    }
  });
  return null;
};
