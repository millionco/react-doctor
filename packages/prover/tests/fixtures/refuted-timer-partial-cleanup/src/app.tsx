import { useEffect, useState } from "react";

interface TimerProperties {
  shouldCancel: boolean;
}

export const PartialCleanupTimer = ({ shouldCancel }: TimerProperties) => {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timerId = window.setInterval(() => setTicks((previousTicks) => previousTicks + 1), 100);
    if (shouldCancel) return () => window.clearInterval(timerId);
    return () => undefined;
  }, [shouldCancel]);

  return <output>{ticks}</output>;
};
