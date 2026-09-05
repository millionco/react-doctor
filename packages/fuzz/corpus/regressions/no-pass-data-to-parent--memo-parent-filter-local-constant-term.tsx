// rule: no-pass-data-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect, useMemo } from "react";
export function Child({ items, onChange }) {
  const value = useMemo(() => {
    const term = "a";
    return items.filter((item) => item.label.includes(term));
  }, [items]);
  useEffect(() => {
    onChange(value);
  }, [value]);
  return null;
}
