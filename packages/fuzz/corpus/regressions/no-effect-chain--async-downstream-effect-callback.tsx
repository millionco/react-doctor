// rule: no-effect-chain
// weakness: control-flow
// source: PR #1204 independent final audit

import { useEffect, useState } from "react";

export const AsyncDownstreamEffectCallback = ({ loadValue }) => {
  const [source, setSource] = useState(0);
  const [target, setTarget] = useState(0);

  useEffect(() => {
    setSource(1);
  }, []);

  const synchronizeTarget = async () => {
    setTarget(await loadValue(source));
  };

  useEffect(synchronizeTarget, [loadValue, source]);
  return target;
};
