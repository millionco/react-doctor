import { useEffect } from "react";

const handleScroll = () => undefined;

export const ScrollTracker = () => {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener("scroll", handleScroll, {
      passive: true,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, []);

  return null;
};
