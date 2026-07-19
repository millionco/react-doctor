// rule: r3f-no-state-in-use-frame
// weakness: copy-tracking
// source: mutable tuple-index provenance regression
import { useState, useTransition } from "react";
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  const [, setCount] = useState(0);
  const stateTuple = useState(0);
  const transitionTuple = useTransition();
  stateTuple[1] = scheduleLater;
  transitionTuple[1] = scheduleLater;
  useFrame(() => {
    stateTuple[1](1);
    transitionTuple[1](() => setCount(2));
  });
  return null;
};
