import "@react-three/fiber";
import { useMemo } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export const ImperativeControls = ({ camera, element }) => {
  const controls = useMemo(() => new OrbitControls(camera, element), [camera, element]);
  return <primitive object={controls} />;
};
