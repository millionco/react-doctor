// rule: no-effect-chain
// verdict: fail
// weakness: control-flow
// source: parity netzwerg/react-svg-timeline

import { useCallback, useEffect, useState } from "react";

export const StateOnlyNestedCleanup = ({ active, source }) => {
  const [mode, setMode] = useState("idle");
  const [cursor, setCursor] = useState("default");
  const setModeIfEnabled = useCallback((nextMode: string) => setMode(nextMode), []);

  useEffect(() => {
    if (active) {
      setModeIfEnabled(source);
      return () => setModeIfEnabled("idle");
    }
  }, [active, source, setModeIfEnabled]);

  useEffect(() => setCursor(mode === "idle" ? "default" : "pointer"), [mode]);
  return cursor;
};
