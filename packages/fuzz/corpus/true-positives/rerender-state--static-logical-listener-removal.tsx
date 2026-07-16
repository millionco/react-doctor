// rule: rerender-state-only-in-handlers
// weakness: expression-control-flow
// source: adversarial review of PR 1311
import { useEffect, useState } from "react";

export const StaticLogicalListenerRemoval = () => {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onPopState = () => setRevision((previous) => previous + 1);
    ((window.addEventListener("popstate", onPopState), true) as boolean) &&
      window.removeEventListener("popstate", onPopState);
  }, []);

  return <output>{window.location.pathname}</output>;
};
