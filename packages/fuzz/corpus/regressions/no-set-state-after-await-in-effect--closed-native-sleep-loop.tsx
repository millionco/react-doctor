// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";

const pause = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export const LoopPanel = ({ revision }: { revision: number }) => {
  const [phase, setPhase] = useState("idle");
  useEffect(() => {
    let cancelled = false;
    const WAIT_MS = 10;
    const run = async () => {
      while (!cancelled) {
        await pause(WAIT_MS);
        if (cancelled) return;
        setPhase("ready");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return <div>{phase}</div>;
};
