// rule: effect-observer-needs-disconnect
// source: proactive PR #1365 resource-order audit

import { useEffect } from "react";

export const Measurements = ({ node }: { node: Element }): null => {
  useEffect(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    const disconnect = observer.disconnect.bind(observer);
    const cleanup = disconnect;
    return cleanup;
  }, [node]);
  return null;
};

declare const measure: () => void;
