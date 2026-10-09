// rule: no-loading-flag-reset-outside-finally
// verdict: fail
// weakness: control-flow; source: independently authored recursive predicate control
import { useState } from "react";

export const RequestPanel = () => {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    const isCurrent = () => !isStale();
    const isStale = () => !isCurrent();
    setLoading(true);
    try {
      await fetch("/records");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  return (
    <button disabled={loading} onClick={run}>
      Load
    </button>
  );
};
