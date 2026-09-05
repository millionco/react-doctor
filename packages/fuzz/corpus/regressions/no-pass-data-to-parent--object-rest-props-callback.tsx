// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
import { readValue } from "data-service";
export function Child({ initial, ...props }) {
  const value = readValue();
  useEffect(() => {
    props.onChange(value);
  }, [value]);
  return null;
}
