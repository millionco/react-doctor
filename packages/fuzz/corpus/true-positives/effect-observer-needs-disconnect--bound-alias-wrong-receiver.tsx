// rule: effect-observer-needs-disconnect
// weakness: alias-bound-cleanup-receiver
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Preview = ({
  element,
  otherObserver,
}: {
  element: Element;
  otherObserver: ResizeObserver;
}) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    const localObserver = observer;
    localObserver.observe(element);
    return localObserver.disconnect.bind(otherObserver);
  }, [element, otherObserver]);
  return null;
};
