// rule: effect-observer-needs-disconnect
// weakness: release-order
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Measurements = ({
  firstNode,
  secondNode,
}: {
  firstNode: Element;
  secondNode: Element;
}): null => {
  useEffect(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(firstNode);
    observer.disconnect();
    observer.observe(secondNode);
  }, [firstNode, secondNode]);
  return null;
};

declare const measure: () => void;
