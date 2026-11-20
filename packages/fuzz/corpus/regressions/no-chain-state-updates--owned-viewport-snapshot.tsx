// rule: no-chain-state-updates
// weakness: library-idiom
// source: Authored viewport snapshot regression
// react-major: 16
// verdict: pass

import { useEffect, useState } from "react";

export function ViewportMenu({ breakpoint }: { breakpoint: number }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [open, setOpen] = useState(true);
  const wide = viewport.width > breakpoint;

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
  };

  useEffect(() => {
    window.addEventListener("resize", onResize);
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [wide]);

  return <output>{String(open)}</output>;
}
