// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 T3 regression

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

interface ReactDependencyArrayAliasProps {
  source: string;
}

export const ReactDependencyArrayAlias = ({ source }: ReactDependencyArrayAliasProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const queryClient = useQueryClient();
  const baseDependencies = [intermediate, queryClient];
  const callbackDependenciesAlias = baseDependencies;
  const callbackDependencies = callbackDependenciesAlias;
  const prefetch = useCallback(
    () => queryClient.prefetchQuery({ queryKey: [intermediate] }),
    callbackDependencies,
  );

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    void prefetch();
    setTarget(intermediate);
  }, [intermediate, prefetch]);

  return target;
};
