// rule: rerender-state-only-in-handlers
// weakness: readonly-setter-alias-location-invalidation
// source: Cursor Bugbot discussion 3596818153 on PR 1311
import { useState } from "react";

export const MutableSetterAliasLocationInvalidation = () => {
  const [revision, setRevision] = useState(0);
  let bump = setRevision;
  bump = () => undefined;
  const navigate = () => {
    history.pushState({}, "", "/next");
    bump((previous) => previous + 1);
  };
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
