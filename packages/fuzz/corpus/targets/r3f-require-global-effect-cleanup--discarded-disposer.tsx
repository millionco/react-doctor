// rule: r3f-require-global-effect-cleanup
// source: R3F loop createSubs contract and Takram deferred-registration bug
import { addEffect } from "@react-three/fiber";
import { useEffect } from "react";

export const GlobalEffectScene = ({ callback }) => {
  useEffect(() => {
    addEffect(callback);
  }, [callback]);
  return null;
};
