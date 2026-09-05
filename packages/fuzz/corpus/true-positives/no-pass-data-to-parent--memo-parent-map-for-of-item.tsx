// rule: no-pass-data-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect, useMemo } from "react";
import { convert } from "data-library";
export function Child({ items, onChange }) {
  const value = useMemo(() => items.map((item) => convert(item)), [items]);
  useEffect(() => {
    for (const item of value) onChange(item);
  }, [value]);
  return null;
}
