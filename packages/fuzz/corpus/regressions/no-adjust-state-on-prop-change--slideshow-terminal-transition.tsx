// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: React Bench SlideshowContext trial 26Vu5Fo

import * as React from "react";
import { useTimeouts } from "./timeouts";

interface SlideshowProps {
  disabled: boolean;
}

export const Slideshow = ({ disabled }: SlideshowProps) => {
  const [playing, setPlaying] = React.useState(true);
  const { setTimeout, clearTimeout } = useTimeouts();
  const scheduler = React.useRef<ReturnType<typeof setTimeout>>();

  const cancelScheduler = React.useCallback(() => {
    clearTimeout(scheduler.current);
    scheduler.current = undefined;
  }, [clearTimeout]);

  React.useEffect(() => {
    if (disabled) {
      cancelScheduler();
      if (playing) {
        setPlaying(false);
      }
    } else if (playing) {
      scheduler.current = setTimeout(() => {}, 1_000);
    }
  }, [playing, disabled, cancelScheduler, setTimeout]);

  return playing;
};
