/* eslint-disable no-eval -- Deliberate parser-only regression shapes. */
// rule: rerender-functional-setstate
// verdict: pass
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read }) => {
  const [items, setItems] = useState([]);

  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      await read();
      eval("index=-1");
    }
    setItems([...items, 1]);
  };
  return <input onChange={handle} />;
};
