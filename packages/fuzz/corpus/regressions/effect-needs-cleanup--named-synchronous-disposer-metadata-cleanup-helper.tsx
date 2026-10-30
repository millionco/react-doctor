// rule: effect-needs-cleanup
// verdict: pass
// weakness: control-flow
// source: strict fuzz seed42 extracted cleanup helper
import { useEffect } from "react";

interface PollingProps {
  ready: Promise<void>;
}

export const Polling = ({ ready }: PollingProps) => {
  useEffect(
    function registerPolling() {
      let release = () => {};
      void (async () => {
        const timer = setInterval(() => {
          void registerPolling.name;
        }, 1000);
        release = () => clearInterval(timer);
        await ready;
      })();
      const cleanup = () => release();
      return () => cleanup();
    },
    [ready],
  );
  return null;
};
