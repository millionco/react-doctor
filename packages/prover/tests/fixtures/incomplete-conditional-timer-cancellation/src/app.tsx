import { useEffect, useState } from "react";

interface TimerProperties {
  shouldCancel: boolean;
}

export const ConditionalCancellationTimer = ({ shouldCancel }: TimerProperties) => {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timerId = window.setInterval(() => setTicks((previousTicks) => previousTicks + 1), 100);
    return () => {
      if (shouldCancel) window.clearInterval(timerId);
    };
  }, [shouldCancel]);

  return <output>{ticks}</output>;
};
