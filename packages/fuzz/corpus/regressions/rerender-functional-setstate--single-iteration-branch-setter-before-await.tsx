// rule: rerender-functional-setstate
// verdict: pass
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ condition, read }) => {
  const [items, setItems] = useState([]);

  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      if (condition) setItems([...items, 1]);
      await read();
    }
  };
  return <input onChange={handle} />;
};
