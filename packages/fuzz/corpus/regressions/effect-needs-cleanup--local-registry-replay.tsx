// rule: effect-needs-cleanup
// verdict: safe
// weakness: control-flow
// source: synthetic listener cleanup registry regression

import { useEffect } from "react";

export function TileListeners({ tiles }: { tiles: EventTarget[] }) {
  useEffect(() => {
    const disconnectors: Array<() => void> = [];
    for (const tile of tiles) {
      const onActivation = () => {};
      tile.addEventListener("activate", onActivation);
      disconnectors.push(() => tile.removeEventListener("activate", onActivation));
    }

    const disconnectTiles = () => disconnectors.forEach((disconnect) => disconnect());
    return () => disconnectTiles();
  }, [tiles]);
  return null;
}
