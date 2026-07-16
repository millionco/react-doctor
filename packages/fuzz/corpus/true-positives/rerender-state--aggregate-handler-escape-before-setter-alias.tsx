// rule: rerender-state-only-in-handlers
// weakness: aggregate-handler-escape-before-setter-alias
// source: independent audit of PR 1311
import { useState } from "react";

export const AggregateHandlerEscapeBeforeSetterAlias = () => {
  const [revision, setRevision] = useState(0);
  const elements = [
    <button
      key="go"
      type="button"
      onClick={() => {
        history.pushState({}, "", "/next");
        bump((previous) => previous + 1);
      }}
    >
      Go
    </button>,
  ];
  registerElements(elements);
  const bump = setRevision;
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      <button type="button" onClick={reset}>
        Reset
      </button>
      {elements}
      <output>{location.pathname}</output>
    </>
  );
};
