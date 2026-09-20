// rule: no-derived-state
// verdict: pass
// weakness: alias-guard
// source: formbricks/formbricks@1380c81bffe44f3ea9e7ff0d9a95fd37044ddc83
import { useEffect, useState } from "react";

const usePendingSelection = (selectedValue: string) => {
  const [open, setOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState(selectedValue);
  useEffect(() => {
    if (!open) setPendingValue(selectedValue);
  }, [open, selectedValue]);
  const edit = setPendingValue;
  const update = edit;
  return { value: open ? pendingValue : selectedValue, update, setOpen };
};

export const DraftPicker = ({ selectedValue }: { selectedValue: string }) => {
  const { value, update, setOpen } = usePendingSelection(selectedValue);
  return (
    <input
      value={value}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onChange={(event) => update(event.target.value)}
    />
  );
};
