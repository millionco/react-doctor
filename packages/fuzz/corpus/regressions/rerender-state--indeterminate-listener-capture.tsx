// rule: rerender-state-only-in-handlers
// weakness: unknown-listener-capture
// source: Bugbot review of PR 1311
import { useEffect, useState } from "react";

interface IndeterminateListenerCaptureProps {
  shouldCapture: boolean;
}

export const IndeterminateListenerCapture = ({
  shouldCapture,
}: IndeterminateListenerCaptureProps) => {
  const [_revision, setRevision] = useState(0);

  useEffect(() => {
    const onPopState = () => setRevision((previous) => previous + 1);
    window.addEventListener("popstate", onPopState, { capture: true });
    window.removeEventListener("popstate", onPopState, { capture: shouldCapture });
  }, [shouldCapture]);

  return <output>{location.pathname}</output>;
};
