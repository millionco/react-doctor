// rule: exhaustive-deps
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
import { useEffect } from "react";

export const EffectRunner = ({ value }: { value: string }) => {
  const useEffect = (callback: () => void) => callback();
  useEffect(() => consume(value), []);
  return null;
};
