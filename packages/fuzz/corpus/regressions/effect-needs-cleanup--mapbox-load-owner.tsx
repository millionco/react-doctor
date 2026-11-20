import { useEffect } from "react";
import Maps from "mapbox-gl";

export function MapOverview({ host, onReady }: { host: HTMLElement; onReady: () => void }) {
  useEffect(() => {
    const map = new Maps.Map({ container: host });
    map.on("load", () => onReady());
    return () => map.remove();
  }, [host, onReady]);
  return null;
}
