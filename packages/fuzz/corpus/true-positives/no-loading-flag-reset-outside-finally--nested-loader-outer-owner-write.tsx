// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: Cursor Bugbot PR #1494
// verdict: fail

import { useEffect, useRef, useState } from "react";

export const DeliveryStatus = () => {
  const [isDeliveryPending, setDeliveryPending] = useState(false);
  const ownerRef = useRef<object | null>(null);

  const cancel = () => {
    ownerRef.current = null;
  };

  useEffect(() => {
    const deliver = async () => {
      const token = {};
      ownerRef.current = token;
      setDeliveryPending(true);
      try {
        await fetch("/deliver");
      } finally {
        if (ownerRef.current === token) setDeliveryPending(false);
      }
    };
    void deliver();
  }, []);

  return <button onClick={cancel}>{isDeliveryPending ? "Cancel" : "Idle"}</button>;
};
