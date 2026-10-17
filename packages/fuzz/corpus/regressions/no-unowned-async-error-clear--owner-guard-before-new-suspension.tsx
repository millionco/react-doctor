// rule: no-unowned-async-error-clear
// verdict: fail
// weakness: alias-guard
// source: independent synthetic owner-snapshot regression
import { useRef, useState } from "react";

export const useSyntheticDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {
  const [error, setError] = useState<unknown | null>(null);
  const requestRef = useRef(requestId);
  requestRef.current = requestId;
  const send = async () => {
    const selected = requestId;
    const result = await task();
    if (requestRef.current !== selected) return false;
    await task();
    if (result.ok) {
      setError(null);
      return true;
    }
    setError({ reason: "not-ready" });
    return false;
  };
  return { error, send };
};
