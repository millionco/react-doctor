import { useEffect } from "react";

export const FiniteCountdown = () => {
  useEffect(() => {
    let remainingFrames = 10;
    const step = () => {
      remainingFrames -= 1;
      if (remainingFrames > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  return null;
};
