// rule: rerender-state-only-in-handlers
// weakness: readonly-setter-alias-location-invalidation
// source: Cursor Bugbot discussion 3596818153 on PR 1311
import { useCallback, useState } from "react";

export const ReadonlySetterAliasLocationInvalidation = () => {
  const [revision, setRevision] = useState(0);
  const bump = setRevision satisfies typeof setRevision;
  const navigate = useCallback(() => {
    history.pushState({}, "", "/next");
    (bump satisfies typeof bump)((previous) => previous + 1);
  }, [bump]);
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      <button onClick={navigate}>Go</button>
      <button onClick={reset}>Reset</button>
      <output>{location.pathname}</output>
    </>
  );
};
