// rule: no-pass-data-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import React, { useEffect, useState } from "react";
import { normalize } from "data-library";

export function Child({ items, onChange }) {
  const [search] = useState("");
  const value = React.useMemo(() => {
    const term = normalize(search);
    return items.filter((item) => normalize(item.label).includes(term));
  }, [items, search]);
  useEffect(() => {
    onChange(value);
  }, [value]);
  return null;
}
