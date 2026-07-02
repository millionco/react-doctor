// rule: no-pass-data-to-parent
// weakness: library-idiom
// source: Claude Code session (forEach(callback) is an iterator idiom, not a
// data leak; flushSync-before-DOM-read is kept as realistic surrounding code —
// no-flush-sync intentionally flags the import, that's its advisory contract)
import { flushSync } from "react-dom";
import { useState } from "react";

export const applyTheme = (attributes: string[], callback: (attr: string) => void) => {
  attributes.forEach(callback);
};

export const ScrollButton = ({ triggerScroll }: { triggerScroll: (left: number) => void }) => {
  const [offsetLeft, setOffsetLeft] = useState(0);
  const handleClick = () => {
    flushSync(() => {
      setOffsetLeft(100);
    });
    triggerScroll(offsetLeft);
  };
  return <button onClick={handleClick}>scroll</button>;
};
