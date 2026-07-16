// rule: rerender-state-only-in-handlers
// weakness: callback-wrapper
// source: PR 1311 Bugbot review

import { useState } from "react";

export const WrappedSynchronousLocationCallback = () => {
  const [_revision, setRevision] = useState(0);
  const navigate = () =>
    ["/next"].forEach(((nextPath) => {
      history.pushState({}, "", nextPath);
    }) satisfies (nextPath: string) => void);
  const currentPaths = [0].map(
    ((_index) => location.pathname) satisfies (_index: number) => string,
  );
  const handleClick = () => {
    navigate();
    setRevision((previous) => previous + 1);
  };
  return <button onClick={handleClick}>{currentPaths.join("")}</button>;
};
