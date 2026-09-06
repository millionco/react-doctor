// rule: no-pass-data-to-parent
// weakness: callback-wrapper-provenance
// source: Synthetic native parity regression
import { useCallback, useEffect, useRef } from "react";
import { read } from "data-service";
export function Child({ onReady }) {
  const readyRef = useRef(onReady);
  const handle = useCallback(() => read(), []);
  useEffect(() => {
    readyRef.current({ handle, inline: () => read() });
  }, [handle]);
  return null;
}
