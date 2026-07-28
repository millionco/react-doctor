import { useEffect, useState } from "react";

export const MutableTimer = () => {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    let timerId = window.setInterval(() => setTicks((previousTicks) => previousTicks + 1), 100);
    return () => window.clearInterval(timerId);
  }, []);

  return <output>{ticks}</output>;
};
