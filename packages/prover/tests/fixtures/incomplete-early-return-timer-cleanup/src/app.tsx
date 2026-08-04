import { useEffect, useState } from "react";

interface TimerProperties {
  shouldKeepAlive: boolean;
}

export const EarlyReturnTimer = ({ shouldKeepAlive }: TimerProperties) => {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timerId = window.setInterval(() => setTicks((previousTicks) => previousTicks + 1), 100);
    return () => {
      if (shouldKeepAlive) return;
      window.clearInterval(timerId);
    };
  }, [shouldKeepAlive]);

  return <output>{ticks}</output>;
};
