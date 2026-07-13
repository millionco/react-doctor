// rule: no-effect-chain
// weakness: control-flow
// source: PR #1182 Bugbot review

import { useEffect, useState } from "react";

export const AsyncEffectCallback = ({ loadValue }) => {
  const [source, setSource] = useState(0);
  const [target, setTarget] = useState(0);

  const loadSource = async () => {
    await loadValue();
    setSource(1);
  };

  useEffect(loadSource, [loadValue]);
  useEffect(() => {
    setTarget(source + 1);
  }, [source]);

  return target;
};
