// rule: r3f-require-global-effect-cleanup
// source: Cursor Bugbot review on PR #1371
import { addEffect } from "@react-three/fiber";
import { useEffect } from "react";

export const Scene = ({ callback, ready }) => {
  useEffect(() => {
    ready.then(() => {
      return addEffect(callback);
    });
  }, [callback, ready]);
  return null;
};
