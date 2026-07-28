import { useEffect } from "react";

const scheduleTimeout = window.setTimeout;
const cancelTimeout = window.clearTimeout;

export const AliasedWindowTimeout = () => {
  useEffect(() => {
    const timeoutId = scheduleTimeout(() => undefined, 100);
    return () => cancelTimeout(timeoutId);
  }, []);

  return <output>waiting</output>;
};
