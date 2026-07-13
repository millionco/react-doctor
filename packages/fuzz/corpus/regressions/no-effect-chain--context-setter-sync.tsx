// rule: no-effect-chain
// weakness: library-idiom
// source: PR #1182 benchmark audit

import { useEffect, useState } from "react";

export const Slideshow = ({ disabled, setAutoPlaying }) => {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (disabled) setPlaying(false);
  }, [disabled]);

  useEffect(() => setAutoPlaying(playing), [playing, setAutoPlaying]);

  return null;
};
