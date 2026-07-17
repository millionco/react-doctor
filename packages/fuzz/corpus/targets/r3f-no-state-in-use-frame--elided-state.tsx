// rule: r3f-no-state-in-use-frame
import { useState } from "react";
import { useFrame } from "@react-three/fiber";

export const Scene = () => {
  const [, setCount] = useState(0);
  useFrame(() => setCount((value) => value + 1));
};
