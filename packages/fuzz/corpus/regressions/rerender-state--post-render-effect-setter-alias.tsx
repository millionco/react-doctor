// rule: rerender-state-only-in-handlers
// weakness: post-render-effect-setter-alias
// source: independent audit of PR 1311
import { useEffect as runEffect, useState } from "react";

export const PostRenderEffectSetterAlias = () => {
  const [revision, setRevision] = useState(0);
  runEffect(() => {
    history.pushState({}, "", "/next");
    bump((previous) => previous + 1);
  }, []);
  const bump = setRevision;
  const reset = () => {
    void revision;
    setRevision(0);
  };

  return <button onClick={reset}>{location.pathname}</button>;
};
