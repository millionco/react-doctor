// rule: rerender-state-only-in-handlers
// weakness: expression-control-flow
// source: Bugbot review of PR 1311
import { useEffect, useState } from "react";

export const ConditionalExpressionListenerRemoval = ({
  shouldRemove,
}: {
  shouldRemove: boolean;
}) => {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onPopState = () => setRevision((previous) => previous + 1);
    const unregister = () =>
      shouldRemove ? window.removeEventListener("popstate", onPopState) : undefined;
    window.addEventListener("popstate", onPopState);
    unregister();
  }, [shouldRemove]);

  return <output>{window.location.pathname}</output>;
};
