// rule: rerender-state-only-in-handlers
// weakness: deferred-readonly-setter-alias-location-invalidation
// source: independent audit of PR 1311
import { useState } from "react";

export const DeferredReadonlySetterAliasLocationInvalidation = () => {
  const [revision, setRevision] = useState(0);
  const navigate = () => {
    history.pushState({}, "", "/next");
    bump((previous) => previous + 1);
  };
  const bump = setRevision;
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
