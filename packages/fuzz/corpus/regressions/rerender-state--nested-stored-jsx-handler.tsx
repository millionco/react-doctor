// rule: rerender-state-only-in-handlers
// weakness: wrapper-transparency
// source: Bugbot review of PR 1311
import { useState } from "react";

export const NestedStoredJsxHandler = () => {
  const [revision, setRevision] = useState(0);
  const view = (
    <section>
      <>
        <button
          type="button"
          onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}
        >
          Go
        </button>
      </>
    </section>
  );
  const bump = setRevision;
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      {view}
      <button type="button" onClick={reset}>
        Reset
      </button>
      <output>{location.pathname}</output>
    </>
  );
};
