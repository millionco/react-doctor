import { useEffect, useRef } from "react";
export function TileWall({ ready, share, children }) {
  const wall = useRef(null);
  useEffect(() => {
    const section = wall.current;
    if (!section) return;
    const resize = new ResizeObserver(() => {
      section.classList.add("measured");
    });
    const update = () => {
      resize.disconnect();
      for (const tile of section.children) {
        resize.observe(tile);
      }
    };
    update();
    const changes = new MutationObserver(update);
    changes.observe(section, { childList: true });
    return () => {
      resize.disconnect();
      changes.disconnect();
    };
  }, [ready, share]);
  return <section ref={wall}>{children}</section>;
}
