// rule: rerender-state-only-in-handlers
// weakness: readonly-value-alias-escape
// source: independent audit of PR 1311
import { useCallback as makeCallback, useState } from "react";

export const ReadonlyValueAliasEscape = () => {
  const [revision, setRevision] = useState(0);
  const navigate = () => {
    history.pushState({}, "", "/next");
    bump((previous) => previous + 1);
  };
  const handler = makeCallback(navigate, []);
  const bump = setRevision;
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      <button onClick={handler}>Go</button>
      <button onClick={reset}>Reset</button>
      <output>{location.pathname}</output>
    </>
  );
};
