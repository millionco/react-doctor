// rule: no-effect-chain
// weakness: name-heuristic
// source: PR #1322 callback-provenance review

import { useCallback, useEffect, useState } from "react";

interface ShadowedExternalSyncCallbackProps {
  source: number;
  setTimeout: (value: number) => void;
}

export const ShadowedExternalSyncCallback = ({
  source,
  setTimeout,
}: ShadowedExternalSyncCallbackProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const derive = useCallback(() => setTimeout(intermediate), [intermediate, setTimeout]);
  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    derive();
    setTarget(intermediate);
  }, [derive, intermediate]);
  return target;
};
