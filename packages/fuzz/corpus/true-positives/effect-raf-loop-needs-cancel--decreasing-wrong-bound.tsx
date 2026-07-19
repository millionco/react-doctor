import { useEffect } from "react";

export const DecreasingWrongBound = () => {
  useEffect(() => {
    let remainingFrames = 10;
    const step = () => {
      remainingFrames -= 1;
      if (remainingFrames < 100) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  return null;
};
