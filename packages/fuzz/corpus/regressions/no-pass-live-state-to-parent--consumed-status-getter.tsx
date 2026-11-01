// rule: no-pass-live-state-to-parent
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic
import { useCallback, useEffect, useState } from "react";

interface StatusGetterProps {
  getLabel: (selection: string) => string;
}

export const ConsumedStatusGetter = ({ getLabel }: StatusGetterProps) => {
  const [selection, setSelection] = useState("start");
  const [status, setStatus] = useState("");
  const readLabel = useCallback((option: string) => getLabel(option), [getLabel]);
  useEffect(() => {
    setStatus(`${readLabel(selection)} selected`);
  }, [readLabel, selection]);
  return <button onClick={() => setSelection("next")}>{status}</button>;
};
