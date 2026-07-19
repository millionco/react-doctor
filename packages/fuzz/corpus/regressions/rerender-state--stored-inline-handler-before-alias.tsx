// rule: rerender-state-only-in-handlers
// weakness: stored-inline-handler-escape-order
// source: independent audit of PR 1311
import { useState } from "react";

export const StoredInlineHandlerBeforeAlias = () => {
  const [revision, setRevision] = useState(0);
  const element = (
    <button
      onClick={() => {
        history.pushState({}, "", "/next");
        bump((previous) => previous + 1);
      }}
    >
      Go
    </button>
  );
  const bump = setRevision;
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      {element}
      <button onClick={reset}>Reset</button>
      <output>{location.pathname}</output>
    </>
  );
};
