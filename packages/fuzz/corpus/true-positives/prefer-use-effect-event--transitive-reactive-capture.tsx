// rule: prefer-use-effect-event
// verdict: fail
// weakness: library-idiom
// source: synthetic
import { useCallback, useEffect } from "react";
export const Example = ({ active, value }) => {
  const leaf = useCallback(() => value, []);
  const callback = useCallback(() => leaf(), [leaf]);
  useEffect(() => {
    const timer = setTimeout(() => callback(), 0);
    return () => clearTimeout(timer);
  }, [callback, active]);
  return null;
};
