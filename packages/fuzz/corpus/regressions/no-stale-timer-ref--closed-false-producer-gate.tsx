/* eslint-disable react/refs */
// rule: no-stale-timer-ref
// source: synthetic timer toggle regression
// weakness: control-flow
// verdict: pass
import { useRef } from "react";

export const InactiveTimerToggle = ({ onTick }) => {
  const timer = useRef(null);
  const ready = useRef(false);
  const toggle = () => {
    if (timer.current || !ready.current) {
      clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => onTick(), 25);
  };
  return <button onClick={toggle}>Toggle</button>;
};
