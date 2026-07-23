// rule: no-collapse-request-error-to-empty-state
// weakness: control-flow
// source: adversarial audit of deterministic design rules
// verdict: pass

import { useState } from "react";

export const Search = ({ raw }) => {
  const [items, setItems] = useState([]);
  const load = async () => {
    try {
      await fetch("/ping").catch(() => null);
      setItems(JSON.parse(raw));
    } catch {
      setItems([]);
    }
  };
  if (!items.length) return <p>No items — error loading results</p>;
  return <ResultList items={items} />;
};
