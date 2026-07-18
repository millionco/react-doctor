// rule: rendering-hydration-no-flicker
// weakness: control-flow
// source: react-bench trial Hx4pzsa

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const Gallery = ({ show }) => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!show || !isClient) {
    return null;
  }

  return createPortal(<div role="dialog" />, document.body);
};
