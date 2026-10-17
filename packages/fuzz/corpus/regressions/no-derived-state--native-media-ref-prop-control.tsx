// rule: no-derived-state
// verdict: fail
// weakness: control-flow
// source: independent synthetic prop-controlled ref companion
import { useEffect, useRef, useState } from "react";
export const NativeRefPropControl = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!mediaRef.current) return;

    if (mime) setFailedKey(mediaKey);
  }, [mime, mediaKey]);
  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;
};
