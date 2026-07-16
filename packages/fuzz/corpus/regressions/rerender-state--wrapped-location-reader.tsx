// rule: rerender-state-only-in-handlers
// weakness: wrapped-render-location-reader
// source: Cursor Bugbot discussion 3596615782 on PR 1311
import { useCallback as useStableCallback, useState } from "react";

export const WrappedLocationReader = () => {
  const [_revision, setRevision] = useState(0);
  const readLocation = () => window.location.pathname;
  const readPath = useStableCallback(readLocation as () => string, []) satisfies () => string;

  const navigate = () => {
    history.pushState({}, "", "/next");
    setRevision((previous) => previous + 1);
  };

  return <button onClick={navigate}>{readPath()}</button>;
};
