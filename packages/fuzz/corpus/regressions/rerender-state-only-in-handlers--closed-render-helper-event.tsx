// rule: rerender-state-only-in-handlers
// weakness: wrapper-transparency
// source: Synthetic private render helper containing a paired notification event.
// verdict: pass
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
  const renderAction = () => <button onClick={activate}>Run</button>;
  return (
    <div>
      {renderAction()}
      <span>{phaseRef.current}</span>
    </div>
  );
};
