// rule: no-set-state-after-await-in-effect
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";
const pause = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));
interface pause {
  unused: true;
}
export const LoopPanel = ({
  revision,
  enabled,
  load,
}: {
  revision: number;
  enabled: boolean;
  load: (...values: unknown[]) => Promise<unknown>;
}) => {
  const [phase, setPhase] = useState("idle");
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        setPhase("idle");
        await pause(10);
        if (cancelled) return;
        setPhase("calling");
        await pause(10);
        if (cancelled) return;
        setPhase("rendering");
        await pause(10);
        if (cancelled) return;
        setPhase("resolving");
        await pause(10);
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [revision, enabled, load]);
  return <div>{phase}</div>;
};
