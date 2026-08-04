import { useEffect } from "react";

const handleScroll = () => undefined;

export const ScrollTracker = () => {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener("scroll", handleScroll, {
      signal: controller.signal,
    });
  }, []);

  return null;
};
