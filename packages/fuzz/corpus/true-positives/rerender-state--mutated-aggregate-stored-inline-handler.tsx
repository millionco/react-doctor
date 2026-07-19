// rule: rerender-state-only-in-handlers
// weakness: mutated-aggregate-stored-inline-handler
// source: independent audit of PR 1311
import { useState } from "react";

export const MutatedAggregateStoredInlineHandler = () => {
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
  const bump = setRevision;
  elements.pop();
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
