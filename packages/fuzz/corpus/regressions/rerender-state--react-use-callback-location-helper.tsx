// rule: rerender-state-only-in-handlers
// weakness: react-use-callback-resolution
// source: Cursor Bugbot discussion 3596487123 on PR 1311
import { useCallback, useEffect, useState } from "react";

export const ReactUseCallbackLocationListener = () => {
  const [_revision, setRevision] = useState(0);
  const onPopState = useCallback(() => setRevision((previous) => previous + 1), []);

  useEffect(() => {
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [onPopState]);

  return <output>{location.pathname}</output>;
};

export const ReactUseCallbackLocationMutationHelper = () => {
  const [_revision, setRevision] = useState(0);
  const navigate = useCallback(() => history.pushState({}, "", "/next"), []);

  return (
    <button
      onClick={() => {
        navigate();
        setRevision((previous) => previous + 1);
      }}
    >
      {location.pathname}
    </button>
  );
};
