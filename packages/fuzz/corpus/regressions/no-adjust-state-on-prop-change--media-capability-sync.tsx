// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: verified ReactBench Jumper trial Zjiziuh

import { useEffect, useState } from "react";

interface AnimatedBackgroundProps {
  mime: string;
  src: string;
}

export const AnimatedBackground = ({ mime, src }: AnimatedBackgroundProps) => {
  const mediaKey = `${src}:${mime}`;
  const [videoSupport, setVideoSupport] = useState<{
    isPlayable: boolean;
    mediaKey: string;
  } | null>(null);

  useEffect(() => {
    if (!src || !mime.startsWith("video/")) {
      setVideoSupport(null);
      return;
    }
    const video = document.createElement("video");
    setVideoSupport({ isPlayable: video.canPlayType(mime) !== "", mediaKey });
  }, [mediaKey, mime, src]);

  return videoSupport?.isPlayable ? <video src={src} /> : null;
};
