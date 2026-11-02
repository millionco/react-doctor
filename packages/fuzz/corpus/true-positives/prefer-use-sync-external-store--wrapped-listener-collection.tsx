// rule: prefer-use-sync-external-store
// weakness: wrapper-transparency
// source: PR 2331 review, synthetic module store with transparent listener receivers
// verdict: fail
import { useEffect, useState } from "react";

let sharedStatus = "idle";
const statusListeners = new Set();
const subscribeStatus = (listener) => {
  (statusListeners as any).add(listener);
  return () => statusListeners!.delete(listener);
};

export const StatusLabel = () => {
  const [status, setStatus] = useState(sharedStatus);
  useEffect(() => subscribeStatus(setStatus), []);
  return <span>{status}</span>;
};
