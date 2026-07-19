// rule: rerender-state-only-in-handlers
// weakness: wrapper-transparency
// source: Cursor Bugbot discussion 3596335303 on PR 1311
import { useCallback, useState } from "react";

export const TypedReactEventCallback = () => {
  const [_revision, setRevision] = useState(0);
  const handleClick = useCallback(() => {
    setRevision((previous) => previous + 1);
    history.pushState({}, "", "/next");
  }, []) satisfies React.MouseEventHandler<HTMLButtonElement>;

  return <button onClick={handleClick}>{location.pathname}</button>;
};
