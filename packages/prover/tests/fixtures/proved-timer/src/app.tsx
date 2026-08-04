import { useEffect, useState } from "react";

export const Clock = () => {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timerId = setInterval(() => setTicks((previousTicks) => previousTicks + 1), 1000);
    return () => clearInterval(timerId);
  }, []);

  return <p>{ticks}</p>;
};
