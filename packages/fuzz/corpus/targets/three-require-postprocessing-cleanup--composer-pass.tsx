// rule: three-require-postprocessing-cleanup
import { useMemo } from "react";
import "three";
import { EffectComposer } from "postprocessing";

export const Scene = ({ renderer }) => {
  const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
  return null;
};
