// rule: effect-needs-cleanup
// verdict: pass
// weakness: control-flow
// source: synthetic harmless named effect reference
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
          if (false) registerPolling();
          if (0) registerPolling();
          if (0n) registerPolling();
          0n ? registerPolling() : undefined;
          if (/x/) {
          } else registerPolling();
        }, 1000);
        release = () => clearInterval(timer);
        await ready;
      })();
      return () => release();
    },
    [ready],
  );
  return null;
};
