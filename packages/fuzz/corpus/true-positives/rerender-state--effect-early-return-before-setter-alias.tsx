// rule: rerender-state-only-in-handlers
// weakness: effect-early-return-before-setter-alias
// source: independent audit of PR 1311
import { useEffect as runEffect, useState } from "react";

export const EffectEarlyReturnBeforeSetterAlias = ({ shouldReturn }) => {
  const [revision, setRevision] = useState(0);
  const reset = () => {
    void revision;
    setRevision(0);
  };
  runEffect(() => {
    history.pushState({}, "", "/next");
    bump((previous) => previous + 1);
  }, []);
  if (shouldReturn) return <button onClick={reset}>{location.pathname}</button>;
  const bump = setRevision;

  return <button onClick={reset}>{location.pathname}</button>;
};
