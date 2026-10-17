// rule: prefer-use-effect-event
// verdict: fail
// weakness: library-idiom
// source: synthetic
import { useCallback, useEffect } from "react";
unknown(useCallback);
export const Example = ({ delay }) => {
  const leaf = useCallback(() => 1, []);
  const callback = useCallback(() => leaf(), [leaf]);
  useEffect(() => {
    const id = setTimeout(() => callback(), delay);
    return () => clearTimeout(id);
  }, [delay, callback]);
  return null;
};
