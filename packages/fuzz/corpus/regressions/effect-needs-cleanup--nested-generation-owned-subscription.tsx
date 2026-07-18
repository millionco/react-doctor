// rule: effect-needs-cleanup
// weakness: control-flow
// source: react-bench FormidableLabs/victory a2Z2PMc false positive
import { useEffect, useRef } from "react";

export const Animation = ({ timer, delay }) => {
  const loopID = useRef<number | undefined>(undefined);
  const delayID = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runID = useRef(0);

  useEffect(() => {
    const cancel = () => {
      runID.current += 1;
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
    };
    const startQueue = (run: number) => {
      const start = () => {
        if (run !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(() => {
          if (run !== runID.current) return;
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          startQueue(run);
        }, 1000);
      };
      if (delay) {
        delayID.current = setTimeout(start, delay);
      } else {
        start();
      }
    };
    startQueue(runID.current);
    return cancel;
  }, [delay, timer]);

  return null;
};
