// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: statically empty eager iterator regression
import { useState } from "react";
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  const [, setCount] = useState(0);
  useFrame(() => {
    [].map(() => setCount(1));
    new Set().forEach(() => setCount(2));
    Array.from([], () => setCount(3));
  });
  return null;
};
