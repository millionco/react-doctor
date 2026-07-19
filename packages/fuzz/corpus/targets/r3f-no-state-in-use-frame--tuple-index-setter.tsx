import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const countState = useState(0);
  useFrame(() => countState[1](countState[0] + 1));
  return countState[0];
};
