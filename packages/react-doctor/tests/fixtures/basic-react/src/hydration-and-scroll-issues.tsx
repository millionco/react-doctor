import { useEffect, useState } from "react";

// rendering-hydration-mismatch-time: dynamic values directly in JSX.
export const NowBanner = () => <span>{new Date().toLocaleString()}</span>;

export const RandomTip = () => <p>{Math.random() > 0.5 ? "Tip A" : "Tip B"}</p>;

export const Stamp = () => <time dateTime={String(Date.now())}>{Date.now()}</time>;

// rerender-transitions-scroll: setState inside high-frequency event listener.
export const ScrollyComponent = () => {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    window.addEventListener("scroll", (event) => {
      void event;
      setScrollY(window.scrollY);
    });
  }, []);

  return <div data-y={scrollY}>Scroll position: {scrollY}</div>;
};
