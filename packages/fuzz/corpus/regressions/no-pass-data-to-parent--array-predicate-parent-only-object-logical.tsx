// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
export function Child({ rows, selected, onChange }) {
  useEffect(() => {
    onChange({ rows: rows.filter((row) => selected.includes(row.id)) ?? [] });
  }, [rows, selected, onChange]);
  return null;
}
