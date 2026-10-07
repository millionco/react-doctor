// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: Cursor Bugbot PR #1494
// verdict: fail

import { useRef, useState } from "react";

export const FeedButton = () => {
  const [isFeedPending, setFeedPending] = useState(false);
  const latestStartedRef = useRef(0);
  const sequenceRef = useRef(0);

  const load = async () => {
    const requestId = ++sequenceRef.current;
    latestStartedRef.current = requestId;
    setFeedPending(true);
    try {
      await fetch("/feed");
    } finally {
      if (requestId <= latestStartedRef.current) setFeedPending(false);
    }
  };

  return <button onClick={() => void load()}>{isFeedPending ? "Loading" : "Load"}</button>;
};
