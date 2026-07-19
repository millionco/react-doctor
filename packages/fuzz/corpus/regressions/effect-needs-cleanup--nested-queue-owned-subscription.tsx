// rule: effect-needs-cleanup
// weakness: control-flow
// source: react-bench FormidableLabs/victory axv5XzX false positive
import { useEffect, useRef } from "react";

export const Animation = ({ timer, delay }) => {
  const loopID = useRef<number | undefined>(undefined);
  const timeoutID = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runID = useRef(0);

  useEffect(() => {
    const stopActiveTimer = () => {
      if (timeoutID.current) {
        clearTimeout(timeoutID.current);
        timeoutID.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
    };
    const stepFrame = (currentRunID: number) => {
      if (currentRunID !== runID.current) return;
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      traverseQueue();
    };
    const traverseQueue = () => {
      runID.current += 1;
      const currentRunID = runID.current;
      const start = () => {
        if (runID.current !== currentRunID) return;
        timeoutID.current = undefined;
        loopID.current = timer.subscribe(() => stepFrame(currentRunID), 1000);
      };
      if (delay) {
        timeoutID.current = setTimeout(start, delay);
      } else {
        start();
      }
    };
    traverseQueue();
    return stopActiveTimer;
  }, [delay, timer]);

  return null;
};
