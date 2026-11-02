// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: synthetic function-binding regression
// verdict: pass
import { useEffect } from "react";

export const Probe = () => {
  useEffect(() => {
    function subscribe() {
      const timer = setInterval(() => {}, 1000);
      return () => clearInterval(timer);
    }
    return subscribe();
  }, []);
  return null;
};
