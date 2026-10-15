// rule: no-ref-current-in-render
// weakness: wrapper-transparency
// source: synthetic
// verdict: fail
import { useCallback, useRef, useState } from "react";

export const Panel = ({ value }: { value: number }) => {
  const container = useRef<number | null>(null);
  const resolveValue = useCallback(() => {
    container.current = value;
    return container.current;
  }, [value]);
  const [initialValue] = useState(resolveValue());
  return <output>{initialValue}</output>;
};
