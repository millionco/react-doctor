// rule: r3f-require-global-effect-cleanup
import { useEffect } from "react";
import { addEffect } from "@react-three/fiber";

export const Scene = ({ callback, enabled }) => {
  useEffect(() => (enabled ? addEffect(callback) : undefined), [callback, enabled]);
};
