// rule: r3f-no-state-in-use-frame
// source: React Three Fiber frame-loop state-update anti-pattern
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const ContinuousStateScene = () => {
  useFrame(() => {
    if (count !== (0 as number)) setCount(count + 1);
  });
  const [count, setCount] = useState(0);
  return null;
};
