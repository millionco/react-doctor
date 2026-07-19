// rule: three-require-animation-mixer-cleanup
import { useMemo } from "react";
import { AnimationMixer } from "three";

export const Scene = ({ root, clip }) => {
  const mixer = useMemo(() => new AnimationMixer(root), [root]);
  mixer.clipAction(clip);
  return null;
};
