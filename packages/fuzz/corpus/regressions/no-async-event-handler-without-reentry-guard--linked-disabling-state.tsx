// rule: no-async-event-handler-without-reentry-guard
// weakness: state-control-guard
// verdict: pass
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
