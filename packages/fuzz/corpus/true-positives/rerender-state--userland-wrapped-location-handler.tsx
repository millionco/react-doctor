// rule: rerender-state-only-in-handlers
// weakness: callback-provenance
// source: PR 1311 Bugbot review

import { useState } from "react";

export const UserlandWrappedLocationHandler = () => {
  const [logged, setLogged] = useState(false);
  const defer = (callback: () => void) => () => queueMicrotask(callback);
  const handleClick = defer(() => {
    setLogged(true);
    history.pushState({}, "", "/next");
  });
  return <button onClick={handleClick}>{location.pathname}</button>;
};
