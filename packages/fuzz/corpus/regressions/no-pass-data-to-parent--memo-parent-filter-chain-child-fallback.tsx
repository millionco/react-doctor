// rule: no-pass-data-to-parent
// weakness: callback-wrapper-provenance
// source: Synthetic native parity regression
import { useEffect, useMemo } from "react";
import { convert, isDefined, readItems } from "data-library";
export function Child({ config, onChange }) {
  const value = useMemo(() => {
    const items = config.items ?? readItems();
    const filtered = items.filter((item) => item.enabled);
    return filtered.map((item) => convert(item)).filter(isDefined);
  }, [config]);
  useEffect(() => {
    onChange(value);
  }, [value]);
  return null;
}
