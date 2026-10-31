// rule: no-derived-state-effect
// verdict: fail
// weakness: alias-guard
// source: independently synthetic ref snapshot argument
import { useEffect, useRef, useState } from "react";
export const CursorLabel = ({ value }: { value: number }) => {
  const [cursor, writeCursor] = useState(0);
  const current = useRef(0);
  const update = (next: number) => {
    writeCursor(value);
    current.current = next;
  };
  useEffect(() => {
    update(current.current);
  }, [value]);
  return <output>{cursor}</output>;
};
