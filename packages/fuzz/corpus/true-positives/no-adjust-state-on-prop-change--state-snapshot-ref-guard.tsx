// rule: no-adjust-state-on-prop-change
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: fail

import { useEffect, useRef, useState } from "react";

export const StateSnapshotGuard = ({ items }) => {
  const [value, setValue] = useState(items);
  const previous = useRef(items);
  const onApply = () => {
    previous.current = [...value];
  };
  const onEdit = (next) => setValue(next);
  useEffect(() => {
    if (previous.current !== items) {
      setValue(items);
      previous.current = items;
    }
  }, [items]);
  return <button onClick={onApply} onChange={onEdit} />;
};
