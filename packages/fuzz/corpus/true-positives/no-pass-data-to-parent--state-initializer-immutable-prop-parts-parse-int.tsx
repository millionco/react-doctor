// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect, useState } from "react";
export function Child({ initial, onChange }) {
  const parts = initial.split("-");
  const [value] = useState(parseInt(parts[0]));
  useEffect(() => {
    onChange(`${value}`);
  }, [value, onChange]);
  return null;
}
