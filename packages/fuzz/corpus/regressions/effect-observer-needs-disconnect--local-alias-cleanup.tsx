// rule: effect-observer-needs-disconnect
// weakness: local-alias-cleanup
// source: PR #1365 Cursor Bugbot
import { useEffect } from "react";

export const Preview = ({ element }: { element: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    const localObserver = observer;
    localObserver.observe(element);
    return () => localObserver.disconnect();
  }, [element]);
  return null;
};
