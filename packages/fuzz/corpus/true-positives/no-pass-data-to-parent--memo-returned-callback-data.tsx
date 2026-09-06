// rule: no-pass-data-to-parent
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: fail

import { useMemo, useEffect } from "react";
export const Preview = ({ onChange }) => {
  const relay = useMemo(() => (value) => onChange(value), [onChange]);
  useEffect(() => {
    relay({ value: 1 });
  }, [relay]);
  return null;
};
