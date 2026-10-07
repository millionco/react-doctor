// verdict: fail
// rule: effect-needs-cleanup
// weakness: copy-tracking
// source: replacement-timer-cleanup adversarial overwrite control
import { useEffect } from "react";

export const ReplacedTimer = ({ update }) => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reposition = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 150);
      timer = setTimeout(update, 150);
    };
    window.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("scroll", reposition);
      clearTimeout(timer);
    };
  }, [update]);
  return null;
};
