// rule: no-effect-chain
// weakness: control-flow
// source: React Bench PortOS paired control

import { useCallback, useEffect, useState } from "react";

interface ReachableHelperCallsiteProps {
  runId: string;
}

export const ReachableHelperCallsite = ({ runId }: ReachableHelperCallsiteProps) => {
  const [runActive, setRunActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const loadFindings = useCallback(() => setStatus("loaded"), []);

  useEffect(() => setRunActive(true), [runId]);
  useEffect(() => {
    if (!runActive) return;
    loadFindings();
  }, [loadFindings, runActive]);

  return status;
};
