// rule: no-effect-chain
// weakness: library-idiom
// source: verified React Bench SlideshowContext trial

import * as React from "react";

interface SlideshowProps {
  currentIndex: number;
  disabled: boolean;
}

interface RedundantChainProps {
  source: number;
}

export const Slideshow = ({ currentIndex, disabled }: SlideshowProps) => {
  const [playing, setPlaying] = React.useState(true);
  const scheduler = React.useRef<ReturnType<typeof setTimeout>>();

  const cancelScheduler = React.useCallback(() => {
    clearTimeout(scheduler.current);
    scheduler.current = undefined;
  }, []);

  React.useEffect(() => {
    if (playing && !disabled) scheduler.current = setTimeout(advanceSlide, 1000);
    else cancelScheduler();
  }, [currentIndex, playing, disabled, cancelScheduler]);

  React.useEffect(() => {
    if (playing && disabled) setPlaying(false);
  }, [playing, disabled]);

  return playing;
};

export const ConciseCleanupSynchronization = ({ source }: RedundantChainProps) => {
  const [intermediate, setIntermediate] = React.useState(source);
  const [target, setTarget] = React.useState(source);
  const subscribeAndCopy = () => {
    setIntermediate(source);
    const unsubscribe = subscribe(source);
    return () => unsubscribe();
  };

  React.useEffect(() => subscribeAndCopy(), [subscribeAndCopy]);
  React.useEffect(() => setTarget(intermediate), [intermediate]);

  return target;
};
