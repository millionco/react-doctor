// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: synthetic child payload inside a memoized callback
// verdict: fail
import { useCallback, useEffect, useState } from "react";

interface PanelProps {
  enabled: boolean;
  onChange: (active: boolean) => void;
}

export const Panel = ({ enabled, onChange }: PanelProps) => {
  const [childActive, setChildActive] = useState(false);
  const notify = useCallback(() => {
    onChange(Boolean(enabled) && childActive);
  }, [enabled, childActive, onChange]);
  useEffect(() => {
    notify();
  }, [notify]);
  return (
    <button type="button" onClick={() => setChildActive(true)}>
      Activate
    </button>
  );
};
