// rule: no-derived-state-effect
// verdict: pass
// weakness: alias-guard
// source: independently synthetic adjacent ref command
import { useEffect, useRef, useState } from "react";
export const CursorLabel = ({ value }: { value: number }) => {
  const [cursor, writeCursor] = useState(0);
  const current = useRef(cursor);
  const update = (next: number) => {
    writeCursor(next);
    current.current = next;
  };
  useEffect(() => {
    update(value);
  }, [value]);
  return <output>{cursor}</output>;
};
