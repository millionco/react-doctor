// rule: no-create-object-url-without-revoke
// verdict: safe
import { useEffect } from "react";
export const View = ({ data, pending }) => {
  useEffect(() => {
    if (pending) return;
    const url = data && URL.createObjectURL(data);
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [data, pending]);
};
