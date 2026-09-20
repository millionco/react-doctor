// rule: no-self-updating-effect
// verdict: fail
// weakness: alias-guard
// source: adversarial control for convergent-effect
import { useEffect, useState } from "react";

export const Carousel = ({ text }: { text: string }) => {
  const [items, setItems] = useState([{ text }]);
  useEffect(() => {
    const current = items[items.length - 1];
    if (text === current.text) return;
    setItems((previous) => [...previous.slice(-1), { text: `${text}!` }]);
  }, [text, items]);
  return null;
};
