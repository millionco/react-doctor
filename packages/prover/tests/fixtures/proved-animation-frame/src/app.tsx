import { useEffect, useState } from "react";

export const FrameStatus = () => {
  const [frameTime, setFrameTime] = useState(0);

  useEffect(() => {
    const frameId = window.requestAnimationFrame((timestamp) => setFrameTime(timestamp));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return <output>{frameTime}</output>;
};
