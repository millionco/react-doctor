// rule: no-derived-state-effect
// verdict: fail
// weakness: alias-guard
// source: independently synthetic ref self-assignment
import { useEffect, useRef, useState } from "react";
export const CursorLabel = ({ value }: { value: number }) => {
  const [cursor, writeCursor] = useState(0);
  const current = useRef(cursor);
  useEffect(() => {
    writeCursor(value);
    current.current = current.current;
  }, [value]);
  return <output>{cursor}</output>;
};
