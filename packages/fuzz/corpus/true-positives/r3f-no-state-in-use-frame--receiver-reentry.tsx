// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: synthetic regression
// verdict: fail
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Indicator = () => {
  const [settled, setSettled] = useState(false);
  useFrame(function frame() {
    if (settled) return;
    setSettled(true);
    this.current();
  });
  return settled ? <mesh /> : null;
};
