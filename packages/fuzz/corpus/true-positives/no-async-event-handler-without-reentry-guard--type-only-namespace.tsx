// rule: no-async-event-handler-without-reentry-guard
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: fail
namespace require {
  export interface Marker {}
}
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
