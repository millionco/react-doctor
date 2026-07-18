// rule: rendering-hydration-no-flicker
// weakness: control-flow
// source: PR 1328 independent audit

import { useEffect, useState } from "react";

export const ResponsiveButton = () => {
  const [windowWidth, setWindowWidth] = useState(0);
  const handleClick = () => console.log(windowWidth);

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

  return <button onClick={handleClick}>Open</button>;
};
