// rule: rerender-state-only-in-handlers
// source: Bugbot review of PR 1311
import { useEffect, useState } from "react";

export const BranchLocalListenerRemoval = ({ shouldRegister }: { shouldRegister: boolean }) => {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onPopState = () => setRevision((previous) => previous + 1);
    shouldRegister
      ? (window.addEventListener("popstate", onPopState),
        window.removeEventListener("popstate", onPopState))
      : undefined;
  }, [shouldRegister]);

  return <output>{window.location.pathname}</output>;
};
