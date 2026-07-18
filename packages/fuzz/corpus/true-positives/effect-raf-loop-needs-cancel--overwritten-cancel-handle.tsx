import { useEffect } from "react";

export const Preview = () => {
  useEffect(() => {
    let frameId = 0;
    const frame = () => {
      frameId = requestAnimationFrame(frame);
      frameId = 0;
    };
    frameId = requestAnimationFrame(frame);
    frameId = 0;
    return () => cancelAnimationFrame(frameId);
  }, []);

  return null;
};
