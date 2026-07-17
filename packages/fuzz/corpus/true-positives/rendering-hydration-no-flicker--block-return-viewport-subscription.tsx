// rule: rendering-hydration-no-flicker
// weakness: callback-expression
// source: fuzz verdict-drop seed 1000484

import { useEffect, useState } from "react";

export const ResponsiveViewportLabel = () => {
  const [windowWidth, setWindowWidth] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      return setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    setWindowWidth(window.innerWidth);
    return () => {
      return window.removeEventListener("resize", handleResize);
    };
  }, []);

  return <output>{windowWidth}</output>;
};
