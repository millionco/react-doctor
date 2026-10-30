// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: control-flow
// source: synthetic dependency rerun that skips generation invalidation
import { useEffect, useRef, useState } from "react";

const SkippedGeneration = ({ enabled, load }) => {
  const [value, setValue] = useState(null);
  const sequence = useRef(0);
  const callback = async () => {
    const snapshot = sequence.current;
    await load();
    if (snapshot === sequence.current) setValue(true);
  };
  useEffect(() => {
    if (!enabled) return;
    sequence.current++;
    callback();
  }, [enabled]);
  return <output>{String(value)}</output>;
};
