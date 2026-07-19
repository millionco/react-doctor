// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1322 review

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

interface NestedReactDependencyContainersProps {
  source: string;
}

export const NestedReactDependencyContainers = ({
  source,
}: NestedReactDependencyContainersProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const queryClient = useQueryClient();
  const innerDependencies = [queryClient];
  const objectDependency = { innerDependencies };
  const spreadDependencies = [intermediate, ...[objectDependency]];
  const [...callbackDependencies] = spreadDependencies;
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
