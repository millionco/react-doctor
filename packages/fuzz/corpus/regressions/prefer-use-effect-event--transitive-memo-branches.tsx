// rule: prefer-use-effect-event
// verdict: pass
// weakness: library-idiom
// source: synthetic
import React, { useCallback, useEffect } from "react";
interface Props {
  active: boolean;
}
export const Example: React.FC<Props> = ({ active }) => {
  const first = useCallback((entry: number) => Math.floor(entry), []);
  const middle = useCallback((entry: number) => first(entry), [first]);
  const callback = useCallback((entry: number) => middle(entry), [middle]);
  const second = useCallback((entry: number) => Math.ceil(entry), []);
  const other = useCallback((entry: number) => second(entry), [second]);
  useEffect(() => {
    if (!active) return;
    let handle = 0;
    const frame = () => {
      callback(1);
      other(2);
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [active, callback, other]);
  return null;
};
