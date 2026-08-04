import { useEffect } from "react";

const handleVisibilityChange = () => undefined;

export const VisibilityTracker = () => {
  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange, {
      capture: false,
      once: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange, {
        capture: false,
      });
  }, []);

  return null;
};
