// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: ship review of PR 1311
import { useEffect, useState } from "react";

export const ConditionalLocationListenerRemoval = ({ shouldRemove }: { shouldRemove: boolean }) => {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onPopState = () => setRevision((previous) => previous + 1);
    const unregister = () => {
      if (shouldRemove) window.removeEventListener("popstate", onPopState);
    };
    window.addEventListener("popstate", onPopState);
    unregister();
  }, [shouldRemove]);

  return <output>{window.location.pathname}</output>;
};
