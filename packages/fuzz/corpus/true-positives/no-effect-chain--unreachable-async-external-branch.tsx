// rule: no-effect-chain
// weakness: control-flow

import { useEffect, useState } from "react";

interface UnreachableAsyncExternalBranchProps {
  source: number;
}

export const UnreachableAsyncExternalBranch = ({ source }: UnreachableAsyncExternalBranchProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => {
    setIntermediate(source);
    void (async () => {
      const shouldFetch = false;
      await (shouldFetch ? fetch("/never") : Promise.resolve(source));
    })();
  }, [source]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
