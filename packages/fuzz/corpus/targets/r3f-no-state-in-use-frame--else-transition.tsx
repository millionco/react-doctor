// rule: r3f-no-state-in-use-frame
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const [count, setCount] = useState(0);
  useFrame(() => {
    const nextCount = readCount();
    if (nextCount !== count) recordChange();
    else setCount(nextCount);
  });
  return count;
};
