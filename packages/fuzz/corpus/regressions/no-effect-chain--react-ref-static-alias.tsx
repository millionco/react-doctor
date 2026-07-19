// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 callback-provenance review

import { createRef, useCallback, useEffect, useState } from "react";

interface ReactRefStaticAliasProps {
  source: number;
}

export const ReactRefStaticAlias = ({ source }: ReactRefStaticAliasProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const bookkeeping = createRef<number>();
  const bookkeepingAlias = bookkeeping;
  const synchronize = useCallback(() => {
    bookkeepingAlias["current"] = intermediate;
  }, [bookkeepingAlias, intermediate]);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    synchronize();
    setTarget(intermediate);
  }, [intermediate, synchronize]);

  return target;
};
