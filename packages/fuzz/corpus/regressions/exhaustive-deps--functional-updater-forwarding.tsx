// rule: exhaustive-deps
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic
import { useEffect, useState } from "react";

const newSelection = (owner: string) => ({ owner, selected: false });

export const Selection = ({ owner, enabled }: { owner: string; enabled: boolean }) => {
  const [selection, setSelection] = useState(() => newSelection(owner));
  const changeSelection = (modify: (value: typeof selection) => typeof selection) =>
    setSelection((previous) => modify(previous.owner === owner ? previous : newSelection(owner)));
  useEffect(() => {
    changeSelection((previous) =>
      enabled && !previous.selected ? { ...previous, selected: true } : previous,
    );
  }, [owner, enabled]);
  return <output>{String(selection.selected)}</output>;
};
