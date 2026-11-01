// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: name-heuristic
// source: synthetic

interface window {}
import * as React from "react";
export function useQueue(callback) {
  const timer = React.useRef(0);
  const queue = React.useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => callback(), 0);
  }, [callback]);
  return queue;
}
