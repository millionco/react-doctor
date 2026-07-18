// rule: rendering-hydration-no-flicker
// weakness: alias-guard
// source: PR 1328 independent audit

import { useEffect, useState } from "react";

export const StableViewportLabel = () => {
  const [windowWidth, setWindowWidth] = useState(0);
  let visibleWidth = windowWidth;
  visibleWidth = 0;

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    setWindowWidth(window.innerWidth);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return <div>{visibleWidth}</div>;
};
