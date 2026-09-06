// rule: no-derived-state
// weakness: state-provenance
// source: synthetic native parity regression
// verdict: pass

import { useEffect, useState } from "react";

export const Preview = ({ items, single }) => {
  const [selected, setSelected] = useState([]);
  useEffect(() => {
    if (single) setSelected(items.slice(0, 1));
    else setSelected((current) => transform(current));
    return () => {};
  }, [items, single]);
  return <div>{selected}</div>;
};
