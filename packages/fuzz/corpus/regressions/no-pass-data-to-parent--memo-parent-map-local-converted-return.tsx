// rule: no-pass-data-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect, useMemo } from "react";
import { convert, isDefined } from "data-library";
export function Child({ items, onChange }) {
  const value = useMemo(() => {
    const filtered = items.filter((item) => item.enabled);
    return filtered
      .map((item) => {
        const extra = items.find((other) => other.id === item.id);
        return convert(item, extra);
      })
      .filter(isDefined);
  }, [items]);
  useEffect(() => {
    onChange(value);
  }, [value]);
  return null;
}
