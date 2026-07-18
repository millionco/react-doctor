// rule: effect-observer-needs-disconnect
// weakness: alias-bound-cleanup
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Preview = ({ element }: { element: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    const localObserver = observer;
    localObserver.observe(element);
    return localObserver.disconnect.bind(localObserver);
  }, [element]);
  return null;
};
