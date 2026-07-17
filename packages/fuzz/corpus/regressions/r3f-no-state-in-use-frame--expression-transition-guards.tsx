// rule: r3f-no-state-in-use-frame
import { useState } from "react";
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  const [count, setCount] = useState(0);
  useFrame(() => {
    const next = readCount();
    void (next !== count ? setCount(next) : logStable());
    void (next === count || setCount(next));
  });
  return count;
};
