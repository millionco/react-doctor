// rule: no-pass-data-to-parent
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: pass

import { useEffect, useRef } from "react";

export const RefPayload = ({ onChange }: { onChange: (value: unknown) => void }) => {
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    valueRef.current = JSON.parse("{}");
    onChange(valueRef.current);
  }, [onChange]);
  return null;
};
