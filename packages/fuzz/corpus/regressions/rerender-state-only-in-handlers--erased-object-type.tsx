// rule: rerender-state-only-in-handlers
// weakness: name-heuristic
// source: synthetic erased Object beside a private ref publication
// verdict: pass

type Object = unknown;
Object.keys({});

import { useCallback, useLayoutEffect, useRef, useState } from "react";
export const StatusPanel = () => {
  const [phase, setPhase] = useState("idle");
  const phaseRef = useRef("idle");
  useLayoutEffect(() => {
    if (phaseRef.current !== phase) setPhase(phaseRef.current);
  }, [phase]);
  const activate = useCallback(() => {
    phaseRef.current = "busy";
    setPhase("busy");
  }, []);
  return <button onClick={activate}>{phaseRef.current}</button>;
};
