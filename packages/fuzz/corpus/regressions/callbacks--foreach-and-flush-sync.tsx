// rule: no-pass-data-to-parent, no-flush-sync
// weakness: library-idiom
// source: Claude Code session (forEach(callback) is an iterator idiom, not a
// data leak; flushSync deliberately flushes before a synchronous DOM read)
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
