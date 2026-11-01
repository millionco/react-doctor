// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: copy-tracking
// source: independent synthetic regression
import { useState } from "react";
interface SliceEditorProps {
  position: number;
  label: string;
}
export const SliceEditor = ({ position, label }: SliceEditorProps) => {
  const [entries, setEntries] = useState<string[]>([]);
  const update = (nextPosition: number, nextLabel: string) =>
    setEntries((previous) => {
      const copy = previous.slice(0, nextPosition);
      copy[nextPosition] = nextLabel;
      return copy;
    });
  return <button onClick={() => update(position, label)}>{entries[0]}</button>;
};
