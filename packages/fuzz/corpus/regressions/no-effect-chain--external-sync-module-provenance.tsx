// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 callback-provenance review

import { fetch as request } from "undici";
import * as timers from "node:timers";
import { useCallback, useEffect, useState } from "react";

interface ExternalSyncModuleProvenanceProps {
  source: number;
}

export const ExternalSyncModuleProvenance = ({ source }: ExternalSyncModuleProvenanceProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const synchronize = useCallback(() => {
    timers.setTimeout(() => request(String(intermediate)), 0);
  }, [intermediate]);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    synchronize();
    setTarget(intermediate);
  }, [intermediate, synchronize]);

  return target;
};
