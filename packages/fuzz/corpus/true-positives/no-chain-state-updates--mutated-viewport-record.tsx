// rule: no-chain-state-updates
// weakness: library-idiom
// source: Authored mutation of a viewport equality updater's previous record
// react-major: 16
// verdict: fail

import { useEffect, useMemo, useState } from "react";

export function ResponsiveMenu({ breakpoint }: { breakpoint: number }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [open, setOpen] = useState(true);
  const wide = useMemo(() => viewport.width > breakpoint, [viewport, breakpoint]);

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
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

  return (
    <button
      onClick={() => {
        viewport.width += 100;
      }}
    >
      {String(open)}
    </button>
  );
}
