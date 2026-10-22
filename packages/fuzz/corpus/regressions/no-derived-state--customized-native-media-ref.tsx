// rule: no-derived-state
// verdict: fail
// weakness: framework-gating
// source: independent synthetic customized native media host regression
import { useEffect, useRef, useState } from "react";
export const CustomizedMediaPreview = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!mediaRef.current) return;
    const media = mediaRef.current;
    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);
  }, [mime, mediaKey]);
  return <>{failedKey === mediaKey ? null : <video is="custom-player" ref={mediaRef} />}</>;
};
