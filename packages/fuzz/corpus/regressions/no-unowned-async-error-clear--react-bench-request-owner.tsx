// rule: no-unowned-async-error-clear
// verdict: pass
// weakness: alias-guard
// source: React Bench 0.9.6 exhaustive audit

import { useRef, useState } from "react";

export const RequestDelivery = ({ request, respond }) => {
  const activeRequestIdRef = useRef(request.requestId);
  const [deliveryError, setDeliveryError] = useState(null);
  const deliver = async () => {
    const targetId = request.requestId;
    const result = await respond(request);
    if (activeRequestIdRef.current !== targetId) return;
    setDeliveryError(result.ok ? null : { requestId: targetId, reason: result.reason });
  };
  return <button onClick={() => void deliver()}>{deliveryError ? "Retry" : "Send"}</button>;
};

export const SnapshotDelivery = ({ request, respond }) => {
  const requestIdRef = useRef(request.requestId);
  requestIdRef.current = request.requestId;
  const [, setDeliveryError] = useState(null);
  const deliver = async () => {
    const sentFor = requestIdRef.current;
    const result = await respond(request);
    if (requestIdRef.current !== sentFor) return;
    setDeliveryError(result.ok ? null : result.reason);
  };
  return <button onClick={() => void deliver()}>Send</button>;
};
