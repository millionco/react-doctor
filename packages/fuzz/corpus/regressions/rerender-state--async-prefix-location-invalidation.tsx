// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: Bugbot review of PR 1311
import { useState } from "react";

export const AsyncPrefixLocationInvalidation = () => {
  const [revision, setRevision] = useState(0);
  const navigate = async () => {
    setRevision((previous) => previous + 1);
    history.pushState({}, "", "/next");
    await Promise.resolve();
  };
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return (
    <>
      <button type="button" onClick={navigate}>
        {location.pathname}
      </button>
      <button type="button" onClick={reset}>
        Reset
      </button>
    </>
  );
};
