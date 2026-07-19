// rule: three-require-postprocessing-cleanup
import { useMemo } from "react";
import "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

export const Scene = ({ renderer, shader }) => {
  const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
  const pass = useMemo(() => new ShaderPass(shader), [shader]);
  composer.addPass(pass);
  return null;
};
