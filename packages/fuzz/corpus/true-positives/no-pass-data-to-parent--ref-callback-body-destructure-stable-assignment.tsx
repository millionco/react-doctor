// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect, useRef } from "react";
import { createValue } from "data-service";
export function Child(props) {
  const { onChange } = props;
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;
  useEffect(() => {
    callbackRef.current?.(createValue());
  }, []);
  return null;
}
