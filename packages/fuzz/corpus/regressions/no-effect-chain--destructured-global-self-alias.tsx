// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 ship review

import { useEffect, useState } from "react";

const { globalThis: globalRoot } = globalThis;
const { ["window"]: windowRoot } = globalThis;
const globalAlias = globalRoot;

interface DestructuredGlobalSelfAliasProps {
  source: number;
}

export const DestructuredGlobalSelfAlias = ({ source }: DestructuredGlobalSelfAliasProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    globalAlias.setTimeout(() => undefined);
    windowRoot.queueMicrotask(() => undefined);
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};
