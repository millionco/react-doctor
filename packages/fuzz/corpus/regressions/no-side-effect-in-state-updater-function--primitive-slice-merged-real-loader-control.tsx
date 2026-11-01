// rule: no-side-effect-in-state-updater-function
// verdict: pass
// file-path: src/components/primitive-slice.tsx
// weakness: alias-guard
// source: synthetic primitive slice review
const require = () => ({ useState: 0 });
interface require {}
require("react").useState = 1;
import { useState } from "react";
export const Example = (position: number, label: string) => {
  const [entries, setEntries] = useState<string[]>([]);
  setEntries((previous) => {
    const copy = previous.slice(0, position);
    copy[position] = label;
    return copy;
  });
  return <output>{entries[0]}</output>;
};
