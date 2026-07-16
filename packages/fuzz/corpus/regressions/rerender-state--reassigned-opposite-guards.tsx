// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: adversarial near-neighbor for Cursor Bugbot discussion 3596124987 on PR 1311
import { useState } from "react";

export const ReassignedOppositeGuards = ({ initialFlag }: { initialFlag: boolean }) => {
  const [revision, setRevision] = useState(0);
  const handleClick = () => {
    let shouldNavigate = initialFlag;
    if (shouldNavigate) history.pushState({}, "", "/next");
    shouldNavigate = false;
    if (!shouldNavigate) setRevision((previous) => previous + 1);
  };
  return <button onClick={handleClick}>{location.pathname}</button>;
};
