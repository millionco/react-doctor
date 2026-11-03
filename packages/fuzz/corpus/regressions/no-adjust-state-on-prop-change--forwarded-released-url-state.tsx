// rule: no-adjust-state-on-prop-change
// weakness: forwarded-setter
// source: forwarded writes skipped the released object URL ownership check
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

export const Preview = ({ open }) => {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!open && preview) {
      URL.revokeObjectURL(preview);
      assign(setPreview, null);
    }
  }, [open, preview]);
  return preview;
};
