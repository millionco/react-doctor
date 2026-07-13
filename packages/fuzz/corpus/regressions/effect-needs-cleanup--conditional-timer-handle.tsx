// rule: effect-needs-cleanup
// weakness: control-flow
// source: React Bench Divz trial fix-react-rdh-lewhunt-divz-divz__yioQpdq
import { useEffect } from "react";

export const Autoplay = ({ playing }: { playing: boolean }) => {
  useEffect(() => {
    const timerId = playing ? setInterval(() => advance(), 1000) : undefined;
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [playing]);
  return null;
};
