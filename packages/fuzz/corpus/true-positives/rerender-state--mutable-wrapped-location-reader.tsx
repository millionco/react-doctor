// rule: rerender-state-only-in-handlers
// weakness: wrapped-render-location-reader
// source: Cursor Bugbot discussion 3596615782 on PR 1311
import { useState } from "react";

export const MutableWrappedLocationReader = () => {
  const [revision, setRevision] = useState(0);
  let path = window.location.pathname;
  path = "/fixed";

  const navigate = () => {
    void revision;
    history.pushState({}, "", "/next");
    setRevision((previous) => previous + 1);
  };

  return <button onClick={navigate}>{path}</button>;
};
