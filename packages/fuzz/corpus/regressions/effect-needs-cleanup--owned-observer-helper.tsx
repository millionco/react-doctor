// rule: effect-needs-cleanup
// verdict: safe
import { useEffect } from "react";
export const Panel = ({ target }) => {
  useEffect(() => {
    if (!target) return;
    const media = window.matchMedia("(pointer: fine)");
    let observer = null;
    const setup = () => {
      if (!media.matches || observer) return;
      observer = new IntersectionObserver(() => {});
      observer.observe(target);
    };
    const teardown = () => {
      observer?.disconnect();
      observer = null;
    };
    const onChange = () => {
      if (media.matches) setup();
      else teardown();
    };
    media.addEventListener("change", onChange);
    setup();
    return () => {
      media.removeEventListener("change", onChange);
      teardown();
    };
  }, [target]);
};
