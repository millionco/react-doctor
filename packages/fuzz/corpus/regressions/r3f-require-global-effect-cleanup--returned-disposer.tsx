// rule: r3f-require-global-effect-cleanup
// weakness: cleanup-correlation
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { addEffect } from "@react-three/fiber";
import { useEffect } from "react";

export const GlobalEffectCleanup = ({ callback }: { callback: () => void }) => {
  useEffect(() => {
    const dispose = addEffect(callback);
    return dispose;
  }, [callback]);
  return null;
};
