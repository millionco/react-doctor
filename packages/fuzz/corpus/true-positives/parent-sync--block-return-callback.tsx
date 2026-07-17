// rule: no-pass-live-state-to-parent, no-prop-callback-in-effect
// weakness: metamorphic-invariance
// source: fuzz seed 1000305
import { useEffect, useState } from "react";

interface SlideshowProps {
  setAutoPlaying: (playing: boolean) => void;
}

export const Slideshow = ({ setAutoPlaying }: SlideshowProps) => {
  const [playing] = useState(false);

  useEffect(() => {
    return setAutoPlaying(playing);
  }, [playing, setAutoPlaying]);

  return null;
};
