/* eslint-disable react/refs */
// rule: no-stale-timer-ref
// source: synthetic timer toggle regression
// weakness: control-flow
// verdict: pass
import { useEffect, useRef } from "react";

export const ClosedClearGate = ({ onTick }) => {
  const timer = useRef(null);
  const enabled = useRef(false);
  useEffect(() => {
    timer.current = setInterval(() => onTick(), 25);
    return () => clearInterval(timer.current);
  }, [onTick]);
  const stop = () => {
    if (enabled.current) {
      clearInterval(timer.current);
      return;
    }
    timer.current = null;
  };
  return <button onClick={stop}>Stop</button>;
};
