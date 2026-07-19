// rule: rerender-state-only-in-handlers
// weakness: wrapper-transparency
// source: Bugbot review of PR 1311
import { useState } from "react";

export const SequenceStoredInlineHandler = () => {
  const [revision, setRevision] = useState(0);
  const element =
    (void 0,
    (
      <button
        type="button"
        onClick={() => {
          history.pushState({}, "", "/next");
          bump((previous) => previous + 1);
        }}
      >
        Go
      </button>
    ));
  const bump = setRevision;
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      {element}
      <button type="button" onClick={reset}>
        Reset
      </button>
      <output>{location.pathname}</output>
    </>
  );
};
