// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: invented synthetic visibility-reset control
// verdict: pass
import { useEffect, useState } from "react";

interface PanelProps {
  visible: boolean;
  register: (callback: () => void) => void;
}

export const Panel = ({ visible, register }: PanelProps) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  useEffect(() => register(() => setOpen(false)), [register]);
  return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
};
