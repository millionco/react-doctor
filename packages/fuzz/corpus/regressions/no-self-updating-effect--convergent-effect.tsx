// rule: no-self-updating-effect
// verdict: pass
// weakness: alias-guard
// source: millionco/expect@39e97500725783490136a8fc7040e6e4dbaafa44 overlay carousel
import { useEffect, useState } from "react";

export const Carousel = ({ text, replace }: { text: string; replace: boolean }) => {
  const [items, setItems] = useState([{ text }]);
  useEffect(() => {
    const current = items[items.length - 1];
    if (text === current.text) return;
    if (replace) {
      setItems([{ text }]);
      return;
    }
    setItems((previous) => [...previous.slice(-1), { text }]);
    const timeout = setTimeout(() => setItems((previous) => previous.slice(-1)), 350);
    return () => clearTimeout(timeout);
  }, [text, items, replace]);
  return null;
};
