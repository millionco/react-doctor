// rule: no-effect-chain
// weakness: control-flow

import { useCallback, useEffect, useState } from "react";

interface HelperParameterGuardProps {
  source: string;
}

export const HelperParameterGuard = ({ source }: HelperParameterGuardProps) => {
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState("idle");
  const load = useCallback((enabled: boolean) => {
    if (!enabled) return;
    setStatus("ready");
  }, []);
  const forward = useCallback((enabled: boolean) => load(enabled), [load]);
  const invoke = forward;

  useEffect(() => setActive(false), [source]);
  useEffect(() => {
    invoke(active);
    invoke(active);
  }, [active, invoke]);

  return status;
};
