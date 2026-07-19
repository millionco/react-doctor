// rule: no-effect-chain
// weakness: async-control-flow

import { useEffect, useState } from "react";
import { deriveLabels } from "./pure-math";

interface ImportedPureAsyncDerivationProps {
  rows: string[];
}

export const ImportedPureAsyncDerivation = ({ rows }: ImportedPureAsyncDerivationProps) => {
  const [activeRows, setActiveRows] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => setActiveRows(rows), [rows]);
  useEffect(() => {
    void (async () => {
      setLabels(await deriveLabels(activeRows));
    })();
  }, [activeRows]);

  return labels.length;
};
