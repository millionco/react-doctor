// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: Cursor Bugbot PR #1494
// verdict: fail

import { useRef, useState } from "react";

export const RefreshButton = () => {
  const [isRefreshPending, setRefreshPending] = useState(false);
  const ownerRef = useRef(0);

  const refresh = async () => {
    const owner = ownerRef.current;
    setRefreshPending(true);
    try {
      await fetch("/refresh");
    } finally {
      if (ownerRef.current === owner) setRefreshPending(false);
    }
  };

  return (
    <button onClick={() => void refresh()}>{isRefreshPending ? "Refreshing" : "Refresh"}</button>
  );
};
