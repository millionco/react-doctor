// rule: no-effect-chain
// weakness: shadow-provenance

import { useEffect, useState } from "react";

interface ShadowedPromiseExecutorProps {
  Promise: new (executor: (resolve: () => void) => void) => PromiseLike<void>;
  source: number;
}

export const ShadowedPromiseExecutor = ({ Promise, source }: ShadowedPromiseExecutorProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => {
    setIntermediate(source);
    void (async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    })();
  }, [Promise, source]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
