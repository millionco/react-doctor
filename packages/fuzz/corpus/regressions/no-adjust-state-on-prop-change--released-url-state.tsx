// rule: no-adjust-state-on-prop-change
// verdict: safe
import { useEffect, useState } from "react";
export const Preview = ({ open }) => {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!open && preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
  }, [open, preview]);
  return preview;
};
