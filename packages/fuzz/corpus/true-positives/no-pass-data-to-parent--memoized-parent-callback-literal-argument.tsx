// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useCallback, useEffect } from "react";
export function Child({ toggle }) {
  const setVisible = useCallback(
    (value) => {
      toggle(value);
    },
    [toggle],
  );
  useEffect(() => {
    setVisible(false);
  }, [setVisible]);
  return null;
}
