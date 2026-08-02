// rule: no-reset-all-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: verified ReactBench Jumper trial 2GBTh7Z

import { useEffect, useState } from "react";

interface VideoPreviewProps {
  src: string;
}

export const VideoPreview = ({ src }: VideoPreviewProps) => {
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [src]);

  return <video hidden={hasFailed} src={src} onError={() => setHasFailed(true)} />;
};
