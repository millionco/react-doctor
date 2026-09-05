// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
import { api } from "query-api";
export function Child({ currentValue, onChange }) {
  const { data } = api.viewer.useQuery();
  useEffect(() => {
    onChange(currentValue || data?.value || "");
  }, [currentValue, data, onChange]);
  return null;
}
