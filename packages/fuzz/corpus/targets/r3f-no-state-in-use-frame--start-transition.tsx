import { useFrame } from "@react-three/fiber";
import { startTransition, useState } from "react";

export const Scene = () => {
  const [, setCount] = useState(0);
  useFrame(() => startTransition(() => setCount((count) => count + 1)));
  return null;
};
