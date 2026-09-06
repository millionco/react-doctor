// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic native parity regression
// verdict: pass

import { useEffect } from "react";

export const Preview = ({ items }) => {
  useEffect(() => {
    const interval = setInterval(() => {
      items.forEach(() => {
        const allocate = () => {
          setTimeout(() => update(), 100);
        };
        allocate();
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [items]);
  return null;
};
