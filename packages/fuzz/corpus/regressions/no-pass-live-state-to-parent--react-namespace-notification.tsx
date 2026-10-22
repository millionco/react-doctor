// rule: no-pass-live-state-to-parent
// verdict: fail
// weakness: wrapper-transparency
// source: synthetic
import React, { useEffect, useState } from "react";

interface ReactCallbackNotificationProps {
  onChange: (selection: string) => void;
}

export const ReactCallbackNotification = ({ onChange }: ReactCallbackNotificationProps) => {
  const [selection, setSelection] = useState("start");
  const notify = React.useCallback((value: string) => onChange(value), [onChange]);
  useEffect(() => {
    notify(selection);
  }, [notify, selection]);
  return <button onClick={() => setSelection("next")}>{selection}</button>;
};
