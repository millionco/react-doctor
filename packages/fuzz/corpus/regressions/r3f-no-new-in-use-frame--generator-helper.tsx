// rule: r3f-no-new-in-use-frame
// weakness: control-flow
// source: adversarial review of millionco/react-doctor#1371
import { useFrame } from "@react-three/fiber";

const allocateLater = function* () {
  yield new Vector3();
};

export const Scene = () => {
  useFrame(() => {
    allocateLater();
  });
  return null;
};
