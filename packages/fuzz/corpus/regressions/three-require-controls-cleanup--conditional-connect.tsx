// rule: three-require-controls-cleanup
// weakness: control-flow
// source: RDE pmndrs/drei@c9d3d0dc src/core/PointerLockControls.tsx
import { useEffect, useMemo } from "react";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

export const Scene = ({ camera, enabled }) => {
  const controls = useMemo(() => new PointerLockControls(camera), [camera]);
  useEffect(() => {
    if (enabled) {
      controls.connect();
      return () => controls.disconnect();
    }
  }, [controls, enabled]);
  return null;
};
