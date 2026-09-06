// rule: no-derived-state
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect, useState } from "react";

export const View = ({ code, session }) => {
  const [status, setStatus] = useState({ kind: "loading" });
  useEffect(() => {
    if (code) {
      setStatus({ kind: "ready", code });
      return;
    }
    const missing = [session ? undefined : "session"].filter(Boolean);
    setStatus({ kind: "missing", missing });
    return () => {};
  }, [code, session]);
  return <div>{status.kind}</div>;
};
