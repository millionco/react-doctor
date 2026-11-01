// rule: no-derived-state-effect
// verdict: fail
// weakness: alias-guard
// source: independently synthetic same literal ref write
import { useEffect, useRef, useState } from "react";
export const CursorLabel = ({ value }: { value: number }) => {
  const [cursor, writeCursor] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    writeCursor(value);
    current.current = 0;
  }, [value]);
  return <output>{cursor}</output>;
};
