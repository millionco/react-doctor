// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: Cursor Bugbot PR #1494
// verdict: fail

import { useRef, useState } from "react";

export const DeliveryButton = () => {
  const [isDeliveryPending, setDeliveryPending] = useState(false);
  const ownerRef = useRef<object | null>(null);

  const deliver = async () => {
    const token = {};
    setDeliveryPending(true);
    ownerRef.current = token;
    try {
      await fetch("/deliver");
    } finally {
      if (ownerRef.current === token) setDeliveryPending(false);
    }
  };

  return <button onClick={() => void deliver()}>{isDeliveryPending ? "Sending" : "Send"}</button>;
};
