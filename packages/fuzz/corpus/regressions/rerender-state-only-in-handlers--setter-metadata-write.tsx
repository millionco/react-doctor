// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";

export const StatusPanel = () => {
  const [request, setRequest] = useState("");
  const [visible, setVisible] = useState("");
  setVisible.description = "visible";
  useEffect(() => {
    if (request) setRequest("");
  }, [request]);
  useEffect(() => {
    setVisible(request);
  }, [request]);
  return <button onClick={() => setRequest("go")}>{visible}</button>;
};
