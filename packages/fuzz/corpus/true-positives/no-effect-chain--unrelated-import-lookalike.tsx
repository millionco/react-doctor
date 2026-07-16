// rule: no-effect-chain
// weakness: name-heuristic
// source: PR #1322 callback-provenance review

import { inspect as fetch } from "undici";
import { useCallback, useEffect, useState } from "react";

interface UnrelatedImportLookalikeProps {
  source: number;
}

export const UnrelatedImportLookalike = ({ source }: UnrelatedImportLookalikeProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const derive = useCallback(() => fetch(intermediate), [intermediate]);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    derive();
    setTarget(intermediate);
  }, [derive, intermediate]);

  return target;
};
