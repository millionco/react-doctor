// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useCallback, useEffect, useRef } from "react";
import { createValue } from "data-service";
export function Child({ onChange }) {
  const rootRef = useRef(null);
  const run = useCallback(
    (value) => {
      rootRef.current?.update(value);
      onChange(createValue(value));
    },
    [onChange],
  );
  useEffect(() => {
    run(createValue());
  }, [run]);
  return null;
}
