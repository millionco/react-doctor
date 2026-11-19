// rule: no-pass-live-state-to-parent
// weakness: library-idiom
// source: synthetic regression
// verdict: pass
import { useCallback, useEffect, useRef } from "react";

const phases = { pending: 1 };
const usePhaseWriter = (): [{ current: number }, (next: number) => void] => {
  const phase = useRef(0);
  const write = useCallback(
    (next: number) => {
      phase.current = next;
    },
    [phase],
  );
  return [phase, write];
};
const usePendingPhase = ({ setPhase }: { setPhase: (value: number) => void }) => {
  useEffect(() => {
    setPhase(phases.pending);
  }, [setPhase]);
};
export const Panel = () => {
  const [, setPhase] = usePhaseWriter();
  usePendingPhase({ setPhase });
  return null;
};
