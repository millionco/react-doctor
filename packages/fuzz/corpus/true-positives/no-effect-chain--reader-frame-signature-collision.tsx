// rule: no-effect-chain
// weakness: control-flow
// source: PR #1322 ship review

import { useCallback, useEffect, useState } from "react";

interface ReaderFrameSignatureCollisionProps {
  source: string;
}

export const ReaderFrameSignatureCollision = ({ source }: ReaderFrameSignatureCollisionProps) => {
  const [intermediate, setIntermediate] = useState(false);
  const [target, setTarget] = useState(false);
  const performWork = useCallback(
    (firstValue: string, _secondValue?: string) => {
      if (firstValue === "x|12:string:y") return;
      setTarget(intermediate);
    },
    [intermediate],
  );

  useEffect(() => setIntermediate(true), [source]);
  useEffect(() => {
    performWork("x", "y");
    performWork("x|12:string:y");
  }, [intermediate, performWork]);

  return target;
};
