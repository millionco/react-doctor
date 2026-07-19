// rule: three-require-animation-mixer-cleanup
// weakness: library-idiom
// source: Three.js AnimationMixer fine-grained action cleanup contract
import { useEffect, useMemo } from "react";
import { AnimationMixer } from "three";

export const Scene = ({ root, clip }) => {
  const mixer = useMemo(() => new AnimationMixer(root), [root]);
  const action = mixer.clipAction(clip);
  useEffect(
    () => () => {
      action.stop();
      mixer.uncacheAction(clip, root);
    },
    [action, clip, mixer, root],
  );
  return null;
};
