// rule: rerender-state-only-in-handlers
// weakness: expression-control-flow
// source: Cursor Bugbot discussion 3596335315 on PR 1311
import { useEffect, useState } from "react";

export const SeparateStaticListenerRemoval = () => {
  const [_revision, setRevision] = useState(0);
  const onPopState = () => setRevision((previous) => previous + 1);

  useEffect(() => {
    window.addEventListener("popstate", onPopState);
    (true satisfies boolean) && window.removeEventListener("popstate", onPopState);
  }, []);

  return <output>{location.pathname}</output>;
};
