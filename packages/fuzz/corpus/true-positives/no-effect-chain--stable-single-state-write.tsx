// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 stable callback paired control

import { useCallback, useEffect, useState } from "react";

interface StableSingleStateWriteProps {
  source: string;
}

export const StableSingleStateWrite = ({ source }: StableSingleStateWriteProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const copyIntermediate = useCallback(() => setIntermediate(source), [source]);

  useEffect(() => copyIntermediate(), [copyIntermediate]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
