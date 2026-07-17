// rule: r3f-no-state-in-use-frame
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const [count, setCount] = useState(0);
  useFrame(() => {
    const nextCount = readCount();
    const didCountChange = nextCount !== count;
    if (didCountChange) setCount(nextCount);
  });
  return count;
};
