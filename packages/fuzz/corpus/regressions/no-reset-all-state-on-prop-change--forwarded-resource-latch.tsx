// rule: no-reset-all-state-on-prop-change
// weakness: wrapper-transparency
// source: image failure state resets for a new resource and is set by its own handler
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

interface ImageProps {
  src: string;
}

export const Image = ({ src }: ImageProps) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    assign(setFailed, false);
  }, [src]);
  return (
    <img src={src} alt={failed ? "failed" : "image"} onError={() => assign(setFailed, true)} />
  );
};
