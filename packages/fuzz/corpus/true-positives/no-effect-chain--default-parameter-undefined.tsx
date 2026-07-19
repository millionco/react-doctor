// rule: no-effect-chain
// weakness: control-flow
// source: PR #1322 ship review

import { useCallback, useEffect, useState } from "react";

interface DefaultParameterChainProps {
  query: string;
}

export const DefaultParameterChain = ({ query }: DefaultParameterChainProps) => {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const load = useCallback((enabled = true) => {
    if (enabled) setStatus("ready");
  }, []);
  const missing = undefined;

  useEffect(() => setActive(true), [query]);
  useEffect(() => {
    load(missing);
  }, [active, load, missing]);

  return status;
};
