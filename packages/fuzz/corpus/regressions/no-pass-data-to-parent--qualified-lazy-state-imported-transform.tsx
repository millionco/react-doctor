// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import * as React from "react";
import { flatten } from "array-library";
export function Child({ items, onChange }) {
  const [selected] = React.useState(() => flatten(items));
  React.useEffect(() => {
    onChange(selected);
  }, [selected]);
  return null;
}
