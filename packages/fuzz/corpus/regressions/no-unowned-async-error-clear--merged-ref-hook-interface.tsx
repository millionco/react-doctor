// rule: no-unowned-async-error-clear
// verdict: pass
// weakness: alias-guard
// source: independent synthetic owner snapshot proof regression
import { useRef, useState } from "react";
interface useRef {}
export const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {
  const [error, setError] = useState<unknown | null>(null);
  const requestRef = useRef(requestId);
  requestRef.current = requestId;
  const send = async () => {
    const mine = requestId;
    const result = await task();
    if (requestRef.current !== mine) return false;
    if (result.ok) {
      setError(null);
      return true;
    }
    setError({ reason: "not-ready" });
    return false;
  };
  return { error, send };
};
