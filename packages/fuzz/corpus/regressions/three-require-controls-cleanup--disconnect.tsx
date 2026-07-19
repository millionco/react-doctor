// rule: three-require-controls-cleanup
import { useEffect, useMemo } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export const Scene = ({ camera, element }) => {
  const controls = useMemo(() => new OrbitControls(camera, element), [camera, element]);
  useEffect(() => () => controls.disconnect(), [controls]);
  return <primitive object={controls} />;
};
