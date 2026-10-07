// rule: no-loading-flag-reset-outside-finally
// weakness: alias-guard
// source: React Bench RDFPFN792026 claude-view PermissionCard
import { useRef, useState } from "react";

export const PermissionCard = () => {
  const [, setDeliveryPending] = useState(false);
  const activeRequestIdRef = useRef(0);
  const requestSequenceRef = useRef(0);

  const deliver = async () => {
    const requestId = ++requestSequenceRef.current;
    activeRequestIdRef.current = requestId;
    setDeliveryPending(true);
    try {
      await fetch("/deliver");
    } finally {
      if (activeRequestIdRef.current === requestId) setDeliveryPending(false);
    }
  };

  return <button onClick={() => void deliver()}>Deliver</button>;
};
