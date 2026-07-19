// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 callback-provenance review

import { useCallback, useEffect, useState } from "react";

interface DestructuredBrowserStorageProps {
  source: number;
}

export const DestructuredBrowserStorage = ({ source }: DestructuredBrowserStorageProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const { localStorage: storage } = window;
  const synchronize = useCallback(() => {
    storage.setItem("value", String(intermediate));
  }, [intermediate, storage]);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    synchronize();
    setTarget(intermediate);
  }, [intermediate, synchronize]);

  return target;
};
