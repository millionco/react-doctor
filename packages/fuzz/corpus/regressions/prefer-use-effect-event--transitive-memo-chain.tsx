// rule: prefer-use-effect-event
// verdict: pass
// weakness: library-idiom
// source: synthetic
import { useCallback, useEffect } from "react";
export const Example = ({ delay }: { delay: number }) => {
  const leaf = useCallback((entry: number) => entry + 1, []);
  const callback = useCallback(() => leaf(1), [leaf]);
  useEffect(() => {
    const handle = setTimeout(() => callback(), delay);
    return () => clearTimeout(handle);
  }, [delay, callback]);
  return null;
};
