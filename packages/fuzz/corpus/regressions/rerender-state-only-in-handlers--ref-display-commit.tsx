// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// verdict: pass
import { useLayoutEffect, useRef, useState } from "react";

export const LoadingBadge = () => {
  const [status, setStatus] = useState("ready");
  const statusRef = useRef("ready");

  useLayoutEffect(() => {
    if (statusRef.current !== status) setStatus(statusRef.current);
  }, [status]);

  const begin = () => {
    statusRef.current = "loading";
    setStatus("loading");
  };

  return <button onClick={begin}>{statusRef.current}</button>;
};
