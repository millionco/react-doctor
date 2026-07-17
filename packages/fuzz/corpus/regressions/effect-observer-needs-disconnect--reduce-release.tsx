// rule: effect-observer-needs-disconnect
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const VisibilityTracker = ({ node }: { node: Element }): null => {
  useEffect(() => {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.reduce((didDisconnect, entry) => {
        if (entry.isIntersecting) currentObserver.disconnect();
        return didDisconnect || entry.isIntersecting;
      }, false);
    });
    observer.observe(node);
  }, [node]);
  return null;
};
