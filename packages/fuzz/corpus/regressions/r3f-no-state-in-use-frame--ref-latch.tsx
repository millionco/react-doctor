// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: RDE pmndrs/react-xr@8d2fda1a examples/hit-testing/src/custom-controller.tsx
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";

export const Scene = ({ controller }) => {
  const pressedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  useFrame(() => {
    if (controller.pressed && !pressedRef.current) {
      pressedRef.current = true;
      setEnabled((current) => !current);
    }
  });
  return enabled ? <mesh /> : null;
};
