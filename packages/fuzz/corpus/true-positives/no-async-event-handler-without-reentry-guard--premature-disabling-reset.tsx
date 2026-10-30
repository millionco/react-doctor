// rule: no-async-event-handler-without-reentry-guard
// weakness: state-control-guard
// verdict: fail
import { useState } from "react";
export const ActionButton = () => {
  const [isDisabling, setIsDisabling] = useState(false);
  const action = async () => {
    setIsDisabling(true);
    await fetch("/api/work", { method: "POST" });
    setIsDisabling(false);
    await fetch("/api/work", { method: "POST" });
    setIsDisabling(false);
  };
  return (
    <button disabled={isDisabling} onClick={action}>
      Run
    </button>
  );
};
