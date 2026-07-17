// rule: effect-needs-cleanup
// weakness: unary-media-listener-cleanup
// source: react-bench write-react-azouaoui-med-react-pro-sidebar ap2s4Kz

import { useEffect } from "react";

export const MediaQuery = ({ breakpoint }: { breakpoint: string }) => {
  useEffect(() => {
    const media = window.matchMedia(breakpoint);
    const handleMatch = () => update(media.matches);
    handleMatch();

    if (media.addEventListener) {
      media.addEventListener("change", handleMatch);
      return () => media.removeEventListener("change", handleMatch);
    }

    media.addListener(handleMatch);
    return () => media.removeListener(handleMatch);
  }, [breakpoint]);

  return null;
};
