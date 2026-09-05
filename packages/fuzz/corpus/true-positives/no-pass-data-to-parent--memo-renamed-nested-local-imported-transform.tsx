// rule: no-pass-data-to-parent
// weakness: callback-wrapper-provenance
// source: Synthetic native parity regression
import { useEffect, useMemo as memoize, useState } from "react";
import { normalize } from "data-library";
export function Child({ items, onChange }) {
  const [search] = useState("");
  const value = memoize(() => {
    const term = normalize(search);
    return items.filter((item) => normalize(item.label).includes(term));
  }, [items, search]);
  useEffect(() => {
    onChange(value);
  }, [value]);
  return null;
}
