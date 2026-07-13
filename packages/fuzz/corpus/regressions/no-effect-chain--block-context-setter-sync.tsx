// rule: no-effect-chain
// weakness: library-idiom
// source: PR #1182 Bugbot review

import { useEffect, useState } from "react";

export const Slideshow = ({ disabled, setAutoPlaying }) => {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (disabled) setPlaying(false);
  }, [disabled]);

  useEffect(() => {
    setAutoPlaying(playing);
  }, [playing, setAutoPlaying]);

  return null;
};
