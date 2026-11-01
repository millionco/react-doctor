// rule: rerender-state-only-in-handlers
// verdict: pass
// weakness: name-heuristic
// source: synthetic

import { useEffect, useState } from "react";
interface PanelProps {
  publish: (payload: string) => void;
}
const Panel = ({ publish }: PanelProps) => {
  interface publish {}
  const [request, setRequest] = useState("");
  useEffect(() => {
    if (request.length > 3) setRequest("");
  }, [request]);
  useEffect(() => {
    const payload = request;
    publish(payload);
  }, [request]);
  return <button onClick={() => setRequest("go")}>Send</button>;
};
