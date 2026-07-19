// rule: three-require-controls-cleanup
// weakness: incomplete-cleanup-method
// source: lifecycle audit
import { useEffect, useMemo } from "react";
import { TransformControls } from "three/addons/controls/TransformControls.js";

export const Scene = ({ camera, element }) => {
  const controls = useMemo(() => new TransformControls(camera, element), [camera, element]);
  useEffect(() => () => controls.disconnect(), [controls]);
  return null;
};
