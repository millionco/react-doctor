// rule: r3f-require-frame-delta
// weakness: control-flow
// source: adversarial review of millionco/react-doctor#1371
import { useFrame } from "@react-three/fiber";

export const Animation = ({ didStart }: { didStart: boolean }) => {
  useFrame(({ scene }) => {
    const advance = () => {
      scene.position.x += 0.1;
    };
    if (didStart) advance();
  });
  return null;
};
