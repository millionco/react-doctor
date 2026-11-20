// rule: no-derived-state
import { useEffect, useRef, useState } from "react";

export const useRetainedReading = (active, latestValue) => {
  const [reading, setReading] = useState(Number(latestValue) || 0);
  const lastMode = useRef(active);

  useEffect(() => {
    const previousMode = lastMode.current;
    const nextReading = Number(latestValue) || 0;

    if (active !== previousMode) {
      setReading(nextReading);
    } else if (!active) {
      setReading(nextReading);
    }
    lastMode.current = active;
  }, [active, latestValue]);

  return reading;
};
