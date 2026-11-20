import { useEffect, useRef, useState } from "react";

const readMobileStyle = (element: HTMLElement) =>
  Boolean(getComputedStyle(element).getPropertyValue("--is-mobile"));

export const LayoutStatus = () => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const canUseBrowser = typeof window !== "undefined";

  useEffect(() => {
    if (layoutRef.current) setIsMobile(readMobileStyle(layoutRef.current));
  }, [sampleCount]);

  return (
    <div ref={layoutRef}>
      <button onClick={() => setSampleCount((currentCount) => currentCount + 1)}>
        Measure layout
      </button>
      {canUseBrowser && <output>{String(isMobile)}</output>}
    </div>
  );
};
