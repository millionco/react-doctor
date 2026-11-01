// rule: no-side-effect-in-state-updater-function
// verdict: pass
// file-path: src/components/primitive-slice.tsx
// weakness: alias-guard
// source: synthetic primitive slice review
import { useState } from "react";
export const Example = (position: number, label: string) => {
  interface label {}
  const [entries, setEntries] = useState<string[]>([]);
  setEntries((previous) => {
    const copy = previous.slice(0, position);
    copy[position] = label;
    return copy;
  });
  return <output>{entries[0]}</output>;
};
