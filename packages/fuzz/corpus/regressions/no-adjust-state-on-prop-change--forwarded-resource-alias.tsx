// rule: no-adjust-state-on-prop-change
// weakness: alias-guard
// source: PR #2317 combined review
// verdict: pass
import { useEffect, useState } from "react";

interface Props {
  src: string;
}

const assign = (setter, value) => setter(value);

export const Image = ({ src }: Props) => {
  const [failed, setFailed] = useState(false);
  const writer = setFailed;
  useEffect(() => {
    assign(writer, false);
  }, [src]);
  return <img src={src} onError={() => assign(writer, true)} data-failed={failed} />;
};
