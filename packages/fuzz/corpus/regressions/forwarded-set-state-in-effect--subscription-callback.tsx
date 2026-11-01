// rule: forwarded-set-state-in-effect
// weakness: forwarded-setter
// source: resize subscription writes through a transparent setter helper only from its callback
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

export const ViewportWidth = () => {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const handleResize = () => assign(setWidth, window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return <output>{width}</output>;
};
