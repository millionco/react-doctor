// rule: no-effect-chain
// weakness: async-control-flow
// source: React Bench AppFlowy paired control

import { useEffect, useState } from "react";

interface LocalAsyncIifeDerivationProps {
  rowIds: string[];
}

export const LocalAsyncIifeDerivation = ({ rowIds }: LocalAsyncIifeDerivationProps) => {
  const [activeRowIds, setActiveRowIds] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => setActiveRowIds(rowIds), [rowIds]);
  useEffect(() => {
    void (async () => {
      const nextLabels = await Promise.resolve(activeRowIds.map(String));
      setLabels(nextLabels);
    })();
  }, [activeRowIds]);

  return labels.length;
};
