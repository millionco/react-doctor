// rule: no-pass-data-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect, useMemo, useState } from "react";
import { normalize } from "data-library";
export function Child({ items, initial, onChange }) {
  const [search] = useState("");
  const [selected] = useState(initial);
  const filtered = useMemo(() => {
    const term = normalize(search);
    return items.filter(
      (item) => item.value !== selected?.value && normalize(item.label).includes(term),
    );
  }, [items, search, selected]);
  const value = useMemo(
    () => (selected ? [selected, ...filtered] : filtered),
    [selected, filtered],
  );
  useEffect(() => {
    onChange?.(value);
  }, [value]);
  return null;
}
