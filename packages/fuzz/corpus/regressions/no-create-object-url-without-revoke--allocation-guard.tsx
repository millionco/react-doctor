// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: independently authored allocation-path regression
import { useEffect } from "react";
export const Preview = ({ blob, pending, update }) => {
  useEffect(() => {
    if (pending) return;
    const url = blob && URL.createObjectURL(blob);
    update(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, pending, update]);
  return null;
};
