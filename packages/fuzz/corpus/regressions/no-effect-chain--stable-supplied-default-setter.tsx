// rule: no-effect-chain
// weakness: control-flow
// source: PR #1322 paired control

import { useCallback, useEffect, useState } from "react";

interface StableSuppliedDefaultSetterProps {
  source: string;
}

export const StableSuppliedDefaultSetter = ({ source }: StableSuppliedDefaultSetterProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const initializeIntermediate = () => {
    setIntermediate(source);
    return source;
  };
  const transition = useCallback(
    (ignored = initializeIntermediate()) => {
      void ignored;
    },
    [source],
  );

  useEffect(() => transition("provided"), [transition]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
