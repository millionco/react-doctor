// rule: no-unowned-async-error-clear
// verdict: pass
// weakness: alias-guard
// source: independent synthetic owner snapshot proof regression
import { useRef, useState } from "react";
interface mineA {}
export const useDeliveryA = (requestId: string, task: () => Promise<void>) => {
  const [error, setErrorA] = useState(null);
  const latestA = useRef(requestId);
  latestA.current = requestId;
  const send = async () => {
    const mineA = requestId;
    await task();
    if (latestA.current === mineA) setErrorA(null);
    setErrorA({ reason: "not-ready" });
  };
  return { error, send };
};
export const useDeliveryB = (requestId: string, task: () => Promise<void>) => {
  const [error, setErrorB] = useState(null);
  const latestB = useRef(requestId);
  latestB.current = requestId;
  const send = async () => {
    const mineB = requestId;
    await task();
    if (latestB.current === mineB) setErrorB(null);
    setErrorB({ reason: "not-ready" });
  };
  return { error, send };
};
