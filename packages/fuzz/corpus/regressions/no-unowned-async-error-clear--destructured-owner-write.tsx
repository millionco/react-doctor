// rule: no-unowned-async-error-clear
// verdict: fail
// weakness: alias-guard
// source: independent synthetic readonly owner mutation regression
import { useRef, useState } from "react";
export const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {
  const [error, setError] = useState<unknown | null>(null);
  const requestRef = useRef(requestId);
  requestRef.current = requestId;
  const send = async () => {
    const mine = requestId;
    ({ requestId } = { requestId: "next" });
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
