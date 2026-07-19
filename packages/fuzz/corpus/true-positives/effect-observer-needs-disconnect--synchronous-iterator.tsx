// rule: effect-observer-needs-disconnect
// weakness: callback-flow
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Measurements = ({ node }: { node: Element }): null => {
  useEffect(() => {
    [node].forEach((target) => {
      const observer = new ResizeObserver(() => measure());
      observer.observe(target);
    });
  }, [node]);
  return null;
};

declare const measure: () => void;
