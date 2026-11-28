// rule: effect-needs-cleanup
// verdict: safe
// weakness: control-flow
// source: synthetic observer ownership regression

import { useEffect, useRef } from "react";

export function Tray({ revision }: { revision: number }) {
  const trayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = trayRef.current;
    if (!panel) return;

    const sizeObserver = new ResizeObserver(() => {});
    const watchTiles = () => {
      for (const tile of panel.children) sizeObserver.observe(tile);
    };
    watchTiles();

    const childObserver = new MutationObserver(() => {
      watchTiles();
    });
    childObserver.observe(panel, { childList: true, subtree: false });
    return () => {
      childObserver.disconnect();
      sizeObserver.disconnect();
    };
  }, [revision]);

  return (
    <div ref={trayRef}>
      <section>{revision}</section>
    </div>
  );
}
