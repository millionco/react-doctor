// rule: rerender-state-only-in-handlers
// weakness: name-heuristic
// source: synthetic private ref publication with an erased callback declaration
// verdict: pass
import { useCallback, useLayoutEffect, useRef, useState } from "react";

type useCallback = unknown;

export const RefNotice = () => {
  const [phase, setPhase] = useState("idle");
  const latest = useRef("idle");
  useLayoutEffect(() => {
    if (latest.current !== phase) setPhase(latest.current);
  }, [phase]);
  const activate = useCallback(() => {
    latest.current = "busy";
    setPhase("busy");
  }, []);
  return <button onClick={activate}>{latest.current}</button>;
};
