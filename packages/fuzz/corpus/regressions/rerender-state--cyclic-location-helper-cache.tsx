// rule: rerender-state-only-in-handlers
// weakness: recursive-cache
// source: Bugbot review of PR 1311
import { useState } from "react";

export const CyclicLocationHelperCache = () => {
  const [_primingRevision, setPrimingRevision] = useState(0);
  const [_revision, setRevision] = useState(0);
  const mutateLocation = (shouldReenter: boolean) => {
    if (shouldReenter) callCycle(false);
    history.pushState({}, "", "/next");
  };
  const callCycle = (shouldReenter: boolean) => mutateLocation(shouldReenter);
  const primeAnalysis = () => {
    setPrimingRevision((previous) => {
      mutateLocation(true);
      return previous + 1;
    });
  };
  const handleClick = () => {
    callCycle(false);
    setRevision((previous) => previous + 1);
  };

  return (
    <>
      <button onClick={primeAnalysis}>Prime</button>
      <button onClick={handleClick}>{location.pathname}</button>
    </>
  );
};
