// rule: no-effect-chain
// weakness: control-flow
// source: React Bench PortOS pinned regression

import { useCallback, useEffect, useState } from "react";

interface GuardedHelperCallsiteProps {
  runId: string;
}

export const GuardedHelperCallsite = ({ runId }: GuardedHelperCallsiteProps) => {
  const [runActive, setRunActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const loadFindings = useCallback(() => setStatus("loaded"), []);

  useEffect(() => setRunActive(false), [runId]);
  useEffect(() => {
    if (!runActive) return;
    loadFindings();
  }, [loadFindings, runActive]);

  return status;
};
