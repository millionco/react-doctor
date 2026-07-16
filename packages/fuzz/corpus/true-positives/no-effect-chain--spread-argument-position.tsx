// rule: no-effect-chain
// weakness: control-flow
// source: PR #1322 ship review

import { useCallback, useEffect, useState } from "react";

interface SpreadArgumentPositionProps {
  flags: [boolean, ...boolean[]];
  query: string;
}

export const SpreadArgumentPosition = ({ flags, query }: SpreadArgumentPositionProps) => {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const load = useCallback((first: boolean, enabled: boolean) => {
    void first;
    if (enabled) return;
    setStatus("ready");
  }, []);

  useEffect(() => setActive(true), [query]);
  useEffect(() => {
    load(...flags, true);
  }, [active, flags, load]);

  return status;
};
