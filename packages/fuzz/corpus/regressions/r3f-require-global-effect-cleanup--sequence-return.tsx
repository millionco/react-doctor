// rule: r3f-require-global-effect-cleanup
// weakness: expression-shape
// source: PR review regression
import { addEffect } from "@react-three/fiber";
import { useEffect } from "react";

export const SequenceCleanup = ({ callback }: { callback: () => void }) => {
  useEffect(() => (prepare(), addEffect(callback)), [callback]);
  return null;
};
