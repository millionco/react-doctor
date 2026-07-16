// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 callback-provenance review

import { useCallback, useEffect, useState } from "react";

interface GlobalSyncAliasesProps {
  source: number;
}

export const GlobalSyncAliases = ({ source }: GlobalSyncAliasesProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const { setTimeout: schedule } = globalThis;
  const Observer = window.ResizeObserver;
  const synchronize = useCallback(() => {
    schedule(() => new Observer(consume), 0);
  }, [Observer, schedule]);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    synchronize();
    setTarget(intermediate);
  }, [intermediate, synchronize]);

  return target;
};
