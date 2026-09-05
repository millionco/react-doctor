// rule: no-pass-data-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect } from "react";
export function Child({ items, onChange }) {
  useEffect(() => {
    const allowed = ["a", "b"];
    const filtered = items.filter(
      (item) => !(allowed.includes(item.kind) && allowed.includes(item.value.toString())),
    );
    onChange(filtered);
  }, [items]);
  return null;
}
