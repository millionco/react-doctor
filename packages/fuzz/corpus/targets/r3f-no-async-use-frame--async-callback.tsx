// rule: r3f-no-async-use-frame
import { useFrame } from "@react-three/fiber";
import { useCallback } from "react";

export const Scene = () => {
  const update = useCallback(async () => {
    await loadAssets();
  }, []);
  useFrame(update);
  return null;
};
