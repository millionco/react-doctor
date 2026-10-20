// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// source: synthetic effect-local callback payload
// verdict: pass
import { useEffect, useState } from "react";

interface AliasPanelProps {
  publish: (payload: string) => void;
}

export const AliasPanel = ({ publish }: AliasPanelProps) => {
  const [request, setRequest] = useState("");
  useEffect(() => {
    if (request === "reset") setRequest("");
  }, [request]);
  useEffect(() => {
    const payload = request;
    publish(payload);
  }, [request, publish]);
  return <button onClick={() => setRequest("go")}>Send</button>;
};
