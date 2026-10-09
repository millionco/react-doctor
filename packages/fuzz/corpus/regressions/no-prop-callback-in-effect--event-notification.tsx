// rule: no-prop-callback-in-effect
// verdict: pass
import { useEffect, useState } from "react";
export const Panel = ({ active, onStart }) => {
  const [phase, setPhase] = useState("idle");
  useEffect(() => {
    if (active && phase === "idle") {
      setPhase("running");
      onStart?.();
    }
  }, [active, phase, onStart]);
  return null;
};
