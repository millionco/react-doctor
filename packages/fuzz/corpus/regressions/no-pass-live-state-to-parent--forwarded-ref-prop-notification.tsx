// rule: no-pass-live-state-to-parent
// weakness: callback-provenance
// source: independently authored synthetic retained prop notification
// verdict: fail
import { forwardRef, useEffect, useState } from "react";

export const Widget = forwardRef(({ onChange }, ref) => {
  const [value] = useState(0);
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return <div ref={ref} />;
});
