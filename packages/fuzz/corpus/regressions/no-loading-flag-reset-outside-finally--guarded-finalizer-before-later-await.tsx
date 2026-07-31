// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: Cursor Bugbot PR #1494
// verdict: pass

import { useRef, useState } from "react";

export const FeedButton = () => {
  const [isFeedPending, setFeedPending] = useState(false);
  const ownerRef = useRef<object | null>(null);

  const load = async () => {
    const token = {};
    ownerRef.current = token;
    setFeedPending(true);
    try {
      prepareFeed();
    } finally {
      if (ownerRef.current === token) setFeedPending(false);
    }
    await fetch("/feed/more");
  };

  return <button onClick={() => void load()}>{isFeedPending ? "Loading" : "Load"}</button>;
};
