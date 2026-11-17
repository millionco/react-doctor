// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Indicator = () => {
  const [settled, setSettled] = useState(false);
  useFrame(() => {
    if (settled) return;
    setSettled(true);
  });
  return settled ? <mesh /> : null;
};
