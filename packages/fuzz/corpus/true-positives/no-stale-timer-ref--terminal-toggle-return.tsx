/* eslint-disable react/refs */
// rule: no-stale-timer-ref
// source: synthetic timer toggle regression
// weakness: control-flow
// verdict: fail
import { useRef } from "react";

export const TimerToggle = ({ onTick }) => {
  const timer = useRef(null);
  const toggle = () => {
    if (timer.current) {
      clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => onTick(), 25);
  };
  return <button onClick={toggle}>Toggle</button>;
};
