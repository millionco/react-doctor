// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 paired control

import { useCallback, useEffect, useState } from "react";

interface ShadowedStableSetterParameterProps {
  source: string;
  writeValue: (value: string) => void;
}

export const ShadowedStableSetterParameter = ({
  source,
  writeValue,
}: ShadowedStableSetterParameterProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const copyIntermediate = useCallback(
    (setIntermediate: (value: string) => void) => setIntermediate(source),
    [source],
  );

  useEffect(() => copyIntermediate(writeValue), [copyIntermediate, writeValue]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return <button onClick={() => setIntermediate(source)}>{target}</button>;
};
