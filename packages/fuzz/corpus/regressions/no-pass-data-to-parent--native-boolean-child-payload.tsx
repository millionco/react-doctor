// rule: no-pass-data-to-parent
// weakness: state-origin
// source: synthetic mutable child state beside a parent conversion
// verdict: fail
import { useEffect, useState } from "react";

interface PanelProps {
  enabled: boolean;
  onChange: (active: boolean) => void;
}

export const Panel = ({ enabled, onChange }: PanelProps) => {
  const [childActive, setChildActive] = useState(false);
  const active = Boolean(enabled) && childActive;
  useEffect(() => {
    onChange(active);
  }, [active, onChange]);
  return (
    <button type="button" onClick={() => setChildActive(true)}>
      Activate
    </button>
  );
};
