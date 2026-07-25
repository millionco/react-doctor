// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: verified React Bench SlideshowContext trial 5sz2qXB

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
    if (playing && disabled) {
      cancelScheduler();
      setPlaying(false);
    }
  }, [playing, disabled, cancelScheduler]);

  return playing;
};
