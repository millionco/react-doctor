// rule: rendering-hydration-no-flicker
// weakness: control-flow
// source: react-bench fix-react-rdh-burhanuday-react-transliterate-index

import { useEffect, useState } from "react";

export const ResponsiveSuggestions = () => {
  const [windowWidth, setWindowWidth] = useState(0);

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

  return windowWidth > 500 ? <div>Suggestions</div> : null;
};
