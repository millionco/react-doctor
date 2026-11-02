// rule: no-adjust-state-on-prop-change
// weakness: wrapper-transparency
// source: related resource lifecycle writer forwarded through a transparent helper
// verdict: pass
import { useEffect, useState } from "react";

const assign = (setter, value) => setter(value);

export const Image = ({ src }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    assign(setFailed, false);
  }, [src]);
  return <img src={src} onError={() => assign(setFailed, true)} data-failed={failed} />;
};
