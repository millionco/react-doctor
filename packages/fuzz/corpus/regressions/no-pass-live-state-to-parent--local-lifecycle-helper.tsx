// rule: no-pass-live-state-to-parent
// weakness: alias-guard
// source: verified React Bench formidablelabs/victory VictoryAnimation trials
// verdict: pass

import { useEffect, useState } from "react";

interface AnimationProps {
  easing: string;
  onEnd: () => void;
}

export const Animation = ({ easing, onEnd }: AnimationProps) => {
  const [frame, setFrame] = useState({ progress: 0 });
  const timer = useTimer();
  const ease = easingTable[formatName(easing)];
  const traverseQueue = (startFrame: { progress: number }) => {
    timer.subscribe(() => setFrame(advance(ease(startFrame.progress))));
    if (isQueueEmpty()) onEnd();
  };

  useEffect(() => {
    traverseQueue(frame);
  }, [frame]);

  return null;
};
