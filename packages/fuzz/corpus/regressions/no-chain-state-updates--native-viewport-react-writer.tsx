// rule: no-chain-state-updates
// verdict: fail
import { useEffect, useMemo, useState } from "react";

export const ResponsiveChoices = ({ enabled, limit }) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [visibleItems, setVisibleItems] = useState([]);
  const wideEnough = useMemo(() => dimensions.width > limit, [dimensions, limit]);
  const visible = enabled && wideEnough;
  const onViewportResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setDimensions({ width, height });
  };
  useEffect(() => {
    window.addEventListener("resize", onViewportResize);
    const width = window.innerWidth;
    const height = window.innerHeight;
    setDimensions({ width, height });
    return () => {
      window.removeEventListener("resize", onViewportResize);
    };
  }, []);
  useEffect(() => {
    if (!visible) {
      setVisibleItems([]);
    }
  }, [visible]);
  return (
    <button onClick={() => setDimensions({ width: limit, height: 0 })}>
      {visible ? visibleItems[0] : null}
    </button>
  );
};
