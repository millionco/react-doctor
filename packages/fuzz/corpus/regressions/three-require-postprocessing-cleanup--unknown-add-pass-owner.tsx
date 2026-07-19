// rule: three-require-postprocessing-cleanup
// weakness: alias-guard
// source: receiver-aware ownership-transfer regression
import { useMemo } from "react";
import "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

export const Scene = ({ manager, shader }) => {
  const pass = useMemo(() => new ShaderPass(shader), [shader]);
  manager.addPass(pass);
  return null;
};
