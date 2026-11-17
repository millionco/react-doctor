// rule: no-pass-live-state-to-parent
// weakness: callback-provenance
// source: independently authored synthetic forwarded-ref regression
// verdict: pass
import { forwardRef, useEffect } from "react";

export const Widget = forwardRef(({ onChange }, ref) => {
  const handle = useHandle({ onChange });
  useEffect(() => {
    if (typeof ref === "function") ref(handle.current);
    return () => {
      if (typeof ref === "function") ref(null);
    };
  }, [ref]);
  return <div />;
});
