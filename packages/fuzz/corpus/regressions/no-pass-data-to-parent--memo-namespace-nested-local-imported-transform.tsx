// rule: no-pass-data-to-parent
// weakness: callback-wrapper-provenance
// source: Synthetic native parity regression
import * as React from "react";
import { normalize } from "data-library";
export function Child({ items, onChange }) {
  const [search] = React.useState("");
  const value = React.useMemo(() => {
    const term = normalize(search);
    return items.filter((item) => normalize(item.label).includes(term));
  }, [items, search]);
  React.useEffect(() => {
    onChange(value);
  }, [value]);
  return null;
}
