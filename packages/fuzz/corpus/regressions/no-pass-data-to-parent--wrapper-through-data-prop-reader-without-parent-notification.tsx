// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useCallback, useEffect } from "react";
import { readValue, useLocalStore } from "data-service";
export function Child({ options }) {
  const { update } = useLocalStore();
  const convert = useCallback((value) => (options.enabled ? value.trim() : value), [options]);
  const forward = useCallback(
    (value) => {
      update(convert(value));
    },
    [update, convert],
  );
  useEffect(() => {
    forward(readValue());
  }, [forward]);
  return null;
}
