// rule: rules-of-hooks
// verdict: fail
// weakness: control-flow
// source: React Bench HostedCart representative trial 2qxm72N

import { useEffect, useRef, useState } from "react";

export const HostedCart = ({ persistKey }: { persistKey?: string }) => {
  const [source, setSource] = useState<string>();

  if (!persistKey) {
    return null;
  }

  const previousPersistKey = useRef(persistKey);
  useEffect(() => {
    if (previousPersistKey.current !== persistKey) {
      previousPersistKey.current = persistKey;
      setSource(undefined);
    }
  }, [persistKey]);

  return <iframe src={source} />;
};
