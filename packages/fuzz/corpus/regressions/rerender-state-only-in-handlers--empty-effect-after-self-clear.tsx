// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// source: synthetic empty effect after self-clear
// verdict: fail
import { useEffect, useState } from "react";

export const EmptyEcho = () => {
  const [request, setRequest] = useState("");
  useEffect(() => {
    if (request === "reset") setRequest("");
  }, [request]);
  useEffect(() => {}, [request]);
  return <button onClick={() => setRequest("go")}>Send</button>;
};
