// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: React Bench RDFPFN792026 claude-view PermissionCard
import { useCallback, useEffect, useRef, useState } from "react";

export const PermissionCard = () => {
  const [, setPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const deliver = useCallback(async () => {
    setPending(true);
    try {
      await fetch("/deliver");
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }, []);

  return <button onClick={() => void deliver()}>Deliver</button>;
};
