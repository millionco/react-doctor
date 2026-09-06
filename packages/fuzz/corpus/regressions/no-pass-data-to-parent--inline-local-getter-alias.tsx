// rule: no-pass-data-to-parent
// weakness: value-provenance
// source: handwritten native parity regression
// verdict: pass

import { useCallback, useEffect } from "react";
export const Preview = (config) => {
  const { getValue } = config;
  const relay = useCallback(
    (value) => {
      const result = getValue(value);
      return result;
    },
    [getValue],
  );
  useEffect(() => {
    relay({ value: 1 });
  }, [relay]);
  return null;
};
