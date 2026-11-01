// rule: no-pass-live-state-to-parent
// verdict: fail
// weakness: wrapper-transparency
// source: synthetic
import { useCallback, useEffect, useState } from "react";

interface NotificationGetterProps {
  getLabel: (selection: string) => string;
}

export const BareGetterNotification = ({ getLabel }: NotificationGetterProps) => {
  const [selection, setSelection] = useState("start");
  const [status, setStatus] = useState("");
  const readLabel = useCallback((option: string) => getLabel(option), [getLabel]);
  useEffect(() => {
    setStatus(`${readLabel(selection)} selected`);
    getLabel(selection);
  }, [getLabel, readLabel, selection]);
  return <button onClick={() => setSelection("next")}>{status}</button>;
};
