// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: Cursor Bugbot PR #1494
// verdict: pass

import { useRef, useState } from "react";

export const DeliveryButton = () => {
  const [isDeliveryPending, setDeliveryPending] = useState(false);
  const ownerRef = useRef(0);
  const sequenceRef = useRef(0);

  const reserveSequence = () => {
    sequenceRef.current += 1;
  };

  const deliver = async () => {
    const token = ++sequenceRef.current;
    ownerRef.current = token;
    setDeliveryPending(true);
    try {
      await fetch("/deliver");
    } finally {
      if (ownerRef.current === token) setDeliveryPending(false);
    }
  };

  return (
    <>
      <button onClick={reserveSequence}>Reserve</button>
      <button onClick={() => void deliver()}>{isDeliveryPending ? "Sending" : "Send"}</button>
    </>
  );
};
