// rule: no-pass-live-state-to-parent
// weakness: dynamic-computed
// source: handwritten synthetic finite character-map and readonly getter conjunction
// verdict: pass

import { useCallback, useEffect, useState } from "react";

interface LabelOption {
  label: string;
}

interface StatusProps {
  getLabel: (selection: string | LabelOption) => string;
}

const translate = (value: string) =>
  String(value).replace(/[ab]/g, (character) => ({ a: "alpha", b: "beta" })[character]);

export const Status = ({ getLabel }: StatusProps) => {
  const [selection, setSelection] = useState<string | LabelOption>("a");
  const [status, setStatus] = useState("");
  const readLabel = useCallback(
    (option: string | LabelOption) =>
      option && typeof option === "object" && "label" in option ? getLabel(option) : option,
    [getLabel],
  );
  useEffect(() => {
    setStatus(`${readLabel(selection)} selected`);
  }, [getLabel, readLabel, selection]);
  return (
    <button title={translate(status)} onClick={() => setSelection("b")}>
      {status}
    </button>
  );
};
