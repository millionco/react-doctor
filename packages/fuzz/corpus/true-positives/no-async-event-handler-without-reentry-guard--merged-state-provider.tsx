// rule: no-async-event-handler-without-reentry-guard
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: fail
const rewriteProvider = () => {
  interface useState {}
  mutate(useState);
};
rewriteProvider();
import { useState } from "react";
export const ActionButton = () => {
  const [isDisabling, setIsDisabling] = useState(false);
  const action = async () => {
    setIsDisabling(true);
    try {
      await fetch("/api/work", { method: "POST" });
    } catch {
      setIsDisabling(false);
    }
  };
  return (
    <button disabled={isDisabling} onClick={action}>
      Run
    </button>
  );
};
