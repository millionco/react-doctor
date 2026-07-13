import { useEffect } from "react";

export const Autoplay = ({ playing }: { playing: boolean }) => {
  useEffect(() => {
    const timerId = playing ? setInterval(() => advance(), 1000) : undefined;
    void timerId;
  }, [playing]);
  return null;
};
