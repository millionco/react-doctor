// rule: no-async-event-handler-without-reentry-guard
// weakness: provider-identity
// source: independent synthetic runtime binding regression
// verdict: pass
const require = (_source: string) => ({ useState: () => [false, () => {}] });
interface require {}
require("react").useState = () => [false, () => {}];
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
