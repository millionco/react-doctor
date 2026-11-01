// rule: no-derived-state-effect
// verdict: fail
// weakness: alias-guard
// source: independently synthetic pure setter helper
import { useEffect, useState } from "react";
export const CursorLabel = ({ value }: { value: number }) => {
  const [cursor, writeCursor] = useState(0);
  const update = (next: number) => {
    writeCursor(next);
  };
  useEffect(() => {
    update(value);
  }, [value]);
  return <output>{cursor}</output>;
};
