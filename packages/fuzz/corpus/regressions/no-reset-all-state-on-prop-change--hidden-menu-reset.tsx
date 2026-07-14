// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: React Bench Cloudscape hidden overflow-menu reset
import { useEffect, useState } from "react";

interface HiddenMenuProps {
  visible: boolean;
}

export const HiddenMenu = ({ visible }: HiddenMenuProps) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [visible]);

  return (
    <section>
      {visible && <button onClick={() => setOpen((currentOpen) => !currentOpen)}>Menu</button>}
      {visible && open && <div role="menu">Drawer</div>}
    </section>
  );
};
