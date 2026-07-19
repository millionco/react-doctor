// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 soundness review

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

interface EscapedReactDependencyArrayProps {
  registerDependencies: (dependencies: unknown[]) => void;
  source: string;
}

export const EscapedReactDependencyArray = ({
  registerDependencies,
  source,
}: EscapedReactDependencyArrayProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const queryClient = useQueryClient();
  const callbackDependencies = [intermediate, queryClient];
  registerDependencies(callbackDependencies);
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
