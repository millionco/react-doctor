// rule: effect-needs-cleanup
// verdict: fail
// weakness: control-flow
// source: synthetic named effect registration ownership
import { useEffect } from "react";

interface PollingProps {
  ready: Promise<void>;
  again: boolean;
  retain: (callback: () => unknown) => void;
}

export const Polling = ({ ready, again, retain }: PollingProps) => {
  useEffect(
    function registerPolling(): () => void {
      let release = () => {};
      void (async () => {
        const timer = setInterval(() => {
          retain(registerPolling);
        }, 1000);
        release = () => clearInterval(timer);
        await ready;
      })();
      return () => release();
    },
    [ready, again, retain],
  );
  return null;
};
