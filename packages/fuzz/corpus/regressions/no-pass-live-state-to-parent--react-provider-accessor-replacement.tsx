// rule: no-pass-live-state-to-parent
// verdict: fail
// weakness: provider-mutation
// source: synthetic
import React, { useEffect, useState } from "react";

interface ProviderAccessorProps {
  getLabel: (selection: string) => string;
  onStatus: (status: string) => void;
}

export const ProviderAccessorReplacement = ({ getLabel, onStatus }: ProviderAccessorProps) => {
  const [selection, setSelection] = useState("start");
  React.__defineGetter__("useState", () => (initial: string) => [initial, onStatus]);
  const [status, setStatus] = React.useState("");
  useEffect(() => {
    setStatus(`${getLabel(selection)} selected`);
  }, [getLabel, selection]);
  return <button onClick={() => setSelection("next")}>{status}</button>;
};
