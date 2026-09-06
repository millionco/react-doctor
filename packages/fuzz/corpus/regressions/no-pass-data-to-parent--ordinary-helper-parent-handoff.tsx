// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
import { readValue } from "data-service";
export function Child({ onChange }) {
  const value = readValue();
  const forward = (next) => {
    onChange(next);
  };
  useEffect(() => forward(value), [value]);
  return null;
}
