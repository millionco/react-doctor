// rule: no-chain-state-updates
// weakness: library-idiom
// source: Authored application-driven resize event
// react-major: 16
// verdict: fail

import { useEffect, useState } from "react";

export function ViewportMenu({
  breakpoint,
  resizeSource,
}: {
  breakpoint: number;
  resizeSource: EventTarget;
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [open, setOpen] = useState(true);
  const wide = viewport.width > breakpoint;

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
  };

  useEffect(() => {
    resizeSource.addEventListener("resize", onResize);
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
    return () => {
      resizeSource.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [wide]);

  return (
    <button onClick={() => resizeSource.dispatchEvent(new Event("resize"))}>{String(open)}</button>
  );
}
