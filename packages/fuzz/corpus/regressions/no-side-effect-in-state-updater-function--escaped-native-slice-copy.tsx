// rule: no-side-effect-in-state-updater-function
// verdict: fail
// weakness: copy-tracking
// source: independent synthetic regression
import { useState } from "react";
interface ObservedSliceEditorProps {
  position: number;
  label: string;
  onCopy: (copy: string[]) => void;
}
export const ObservedSliceEditor = ({ position, label, onCopy }: ObservedSliceEditorProps) => {
  const [entries, setEntries] = useState<string[]>([]);
  const update = () =>
    setEntries((previous) => {
      const copy = previous.slice(0, position);
      onCopy(copy);
      copy[position] = label;
      return copy;
    });
  return <button onClick={update}>{entries[0]}</button>;
};
