// rule: no-loading-flag-reset-outside-finally
// verdict: pass
import { useRef, useState } from "react";

export const RequestPanel = () => {
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    const token = ++request.current;
    const isCurrent = () => request.current === token;
    setLoading(true);
    try {
      await fetch("/records");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  return (
    <button onClick={run} disabled={loading}>
      Load
    </button>
  );
};
