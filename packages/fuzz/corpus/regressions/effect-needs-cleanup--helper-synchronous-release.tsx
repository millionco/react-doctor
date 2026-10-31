// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: synthetic function-binding regression
// verdict: pass
import { useEffect } from "react";

export const Probe = () => {
  useEffect(() => {
    function measure() {
      const timer = setInterval(() => {}, 1000);
      clearInterval(timer);
    }
    measure();
  }, []);
  return null;
};
