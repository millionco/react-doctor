// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: verified ReactBench Jumper trial 2GBTh7Z

import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";

interface AnimatedBackgroundProps {
  mime: string;
  src: string;
}

export const AnimatedBackground = ({ mime, src }: AnimatedBackgroundProps) => {
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [src, mime]);

  const handleLoadedData = (event: SyntheticEvent<HTMLVideoElement>) => {
    event.currentTarget.play()?.catch(() => setHasFailed(true));
  };

  return (
    <video
      hidden={hasFailed}
      src={src}
      onError={() => setHasFailed(true)}
      onLoadedData={handleLoadedData}
    />
  );
};
