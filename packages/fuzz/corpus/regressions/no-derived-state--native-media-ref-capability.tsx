// rule: no-derived-state
// verdict: pass
// weakness: library-idiom
// source: independent synthetic native media ref capability
import { useEffect, useRef, useState } from "react";
export const NativeRefCapability = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!mediaRef.current) return;
    const media = mediaRef.current;

    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);
  }, [mime, mediaKey]);
  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;
};
