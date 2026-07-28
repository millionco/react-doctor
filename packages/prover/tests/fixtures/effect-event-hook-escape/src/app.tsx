import { useEffect, useEffectEvent } from "react";

const useTimer = (callback: () => void) => {
  useEffect(() => {
    const timer = setInterval(callback, 1000);
    return () => clearInterval(timer);
  }, [callback]);
};

export const Timer = () => {
  const onTick = useEffectEvent(() => undefined);
  useTimer(onTick);
  return null;
};
