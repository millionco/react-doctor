// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
export function Child({ rows, onChange }) {
  const selected = new Set(["a"]);
  useEffect(() => {
    onChange({ rows: rows.filter((row) => selected.has(row.id)) ?? [] });
  }, [rows, onChange]);
  return null;
}
