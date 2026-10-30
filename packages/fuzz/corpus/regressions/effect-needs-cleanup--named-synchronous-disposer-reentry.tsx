// rule: effect-needs-cleanup
// verdict: fail
// weakness: control-flow
// source: synthetic named effect registration ownership
import { useEffect } from "react";

interface PollingProps {
  ready: Promise<void>;
  again: boolean;
}

export const Polling = ({ ready, again }: PollingProps) => {
  useEffect(
    function registerPolling(): () => void {
      let release = () => {};
      void (async () => {
        const timer = setInterval(() => {
          if (again) registerPolling();
        }, 1000);
        release = () => clearInterval(timer);
        await ready;
      })();
      return () => release();
    },
    [ready, again],
  );
  return null;
};
