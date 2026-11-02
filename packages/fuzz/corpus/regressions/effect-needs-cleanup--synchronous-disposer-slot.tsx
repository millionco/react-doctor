// rule: effect-needs-cleanup
// verdict: pass
// weakness: control-flow
// source: synthetic synchronous disposer publication
import { useEffect } from "react";

interface PollingProps {
  ready: Promise<void>;
}

export const Polling = ({ ready }: PollingProps) => {
  useEffect(() => {
    let release = () => {};
    void (async () => {
      const timer = setInterval(() => {}, 1000);
      release = () => clearInterval(timer);
      await ready;
    })();
    return () => release();
  }, [ready]);
  return null;
};
