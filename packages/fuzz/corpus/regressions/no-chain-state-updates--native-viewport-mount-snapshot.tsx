// rule: no-chain-state-updates
// verdict: pass
import { useEffect, useMemo, useRef, useState } from "react";

export const ResponsiveChoices = ({ enabled, limit }) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [visibleItems, setVisibleItems] = useState([]);
  const epochRef = useRef(0);
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
      epochRef.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!visible) {
      setVisibleItems([]);
    }
  }, [visible]);
  return <output>{visible ? visibleItems[0] : null}</output>;
};
