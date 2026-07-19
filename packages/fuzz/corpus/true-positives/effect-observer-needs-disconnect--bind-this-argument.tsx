// rule: effect-observer-needs-disconnect
// weakness: ownership-escape
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Tracker = ({ node }: { node: Element }): null => {
  useEffect(() => {
    const observer = new ResizeObserver(callback);
    callback.bind(observer);
    observer.observe(node);
  }, [node]);
  return null;
};

declare const callback: ResizeObserverCallback;
