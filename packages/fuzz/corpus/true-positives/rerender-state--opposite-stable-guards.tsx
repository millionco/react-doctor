// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: Cursor Bugbot discussion 3596124987 on PR 1311
import { useState } from "react";

export const OppositeStableGuards = ({ shouldNavigate }: { shouldNavigate: boolean }) => {
  const [logged, setLogged] = useState(false);
  const handleClick = () => {
    if (shouldNavigate) history.pushState({}, "", "/next");
    if (!shouldNavigate) setLogged(true);
  };
  return <button onClick={handleClick}>{location.pathname}</button>;
};
