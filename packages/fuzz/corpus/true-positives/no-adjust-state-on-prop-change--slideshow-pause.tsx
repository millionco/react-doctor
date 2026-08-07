// rule: no-adjust-state-on-prop-change
// verdict: fail
// weakness: wrapper-transparency
// source: React Bench SlideshowContext policy cohort, representative trial 26Vu5Fo

import * as React from "react";

interface SlideshowProps {
  currentIndex: number;
  disabled: boolean;
}

export const Slideshow = ({ currentIndex, disabled }: SlideshowProps) => {
  const [playing, setPlaying] = React.useState(true);
  const pause = React.useCallback(() => {
    if (playing) {
      setPlaying(false);
    }
  }, [playing]);

  React.useEffect(() => {
    if (playing && disabled) {
      pause();
    }
  }, [currentIndex, playing, disabled, pause]);

  return playing;
};
