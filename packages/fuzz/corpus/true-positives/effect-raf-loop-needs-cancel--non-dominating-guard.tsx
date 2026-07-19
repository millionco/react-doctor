import { useEffect } from "react";

export const Preview = () => {
  useEffect(() => {
    let active = true;
    const frame = () => {
      if (active) console.log("active");
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      active = false;
    };
  }, []);

  return null;
};
