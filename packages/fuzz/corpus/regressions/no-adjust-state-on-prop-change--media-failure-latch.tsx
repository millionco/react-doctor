// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: React Bench RD 0.9.3 second-pass FP-002

import { useEffect, useState } from "react";

interface AnimatedBackgroundImageProps {
  mime: string;
  src: string;
}

export const AnimatedBackgroundImage = ({ mime, src }: AnimatedBackgroundImageProps) => {
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [mime, src]);

  return hasFailed ? null : <video onError={() => setHasFailed(true)} src={src} />;
};
