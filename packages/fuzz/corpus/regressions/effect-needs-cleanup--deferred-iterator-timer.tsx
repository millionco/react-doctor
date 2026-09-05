// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic native parity regression
// verdict: fail

import { useEffect } from "react";

export const Preview = ({ items }) => {
  useEffect(() => {
    const interval = setInterval(() => {
      items.forEach(() => {
        setTimeout(() => update(), 100);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [items]);
  return null;
};
