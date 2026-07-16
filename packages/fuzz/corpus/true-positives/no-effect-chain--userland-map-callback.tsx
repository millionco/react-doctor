// rule: no-effect-chain
// weakness: callback-provenance

import { useEffect, useState } from "react";

interface UserlandMapCallbackProps {
  scheduler: { map: (callback: () => Promise<Response>) => Promise<Response>[] };
  source: number;
}

export const UserlandMapCallback = ({ scheduler, source }: UserlandMapCallbackProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => {
    setIntermediate(source);
    void (async () => {
      await Promise.all(scheduler.map(() => fetch("/rows")));
    })();
  }, [scheduler, source]);
  useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
