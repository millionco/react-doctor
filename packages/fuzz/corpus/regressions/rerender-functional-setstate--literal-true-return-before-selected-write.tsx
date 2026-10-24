/* eslint-disable no-constant-condition -- Deliberate parser-only regression shapes. */
// rule: rerender-functional-setstate
// verdict: pass
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read }) => {
  const [items, setItems] = useState([]);

  const handle = async () => {
    await read();
    if (true) return;
    setItems([...items, 1]);
  };
  return <input onChange={handle} />;
};
