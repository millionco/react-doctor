import { useEffect } from "react";

export const CastRafHelperCall = () => {
  useEffect(() => {
    const loop = () => requestAnimationFrame(loop);
    const start = () => requestAnimationFrame(loop);
    (start as typeof start)();
  }, []);

  return null;
};
