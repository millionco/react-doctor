// rule: effect-observer-needs-disconnect
// weakness: name-heuristic
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Tracker = (): null => {
  useEffect(() => {
    const observer = new ResizeObserver(callback);
    const observe = () => observer.observe(node);
    [noop].forEach((observe) => observe());
    void observe;
  }, []);
  return null;
};

declare const callback: ResizeObserverCallback;
declare const node: Element;
declare const noop: () => void;
