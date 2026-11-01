import { useEffect } from "react";

declare const tick: () => void;
declare const afterAllocation: () => void;

export const ReturnedTimerFactory = () => {
  useEffect(() => {
    const setup = () => {
      const timer = setInterval(tick, 1000);
      afterAllocation();
      return () => clearInterval(timer);
    };
    return setup();
  }, []);
  return null;
};
