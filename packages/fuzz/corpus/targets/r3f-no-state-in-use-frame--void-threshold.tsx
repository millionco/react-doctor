// rule: r3f-no-state-in-use-frame
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const [frameCount, setFrameCount] = useState(1);
  useFrame(() => {
    if (frameCount !== void 0) setFrameCount(frameCount + 1);
  });
  return frameCount;
};
