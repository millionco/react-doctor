// rule: rendering-hydration-no-flicker
// weakness: callback-expression
// source: PR 1328 Bugbot review

import { useEffect, useState } from "react";

export const ResponsiveViewportLabel = () => {
  const [windowWidth, setWindowWidth] = useState(0);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    setWindowWidth(window.innerWidth);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return <output>{windowWidth}</output>;
};
