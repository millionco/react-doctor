// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
import { readValue } from "data-service";
export function createHook() {
  return function useValue({ onChange }) {
    const value = readValue();
    useEffect(() => {
      onChange(value);
    }, [value, onChange]);
    return value;
  };
}
