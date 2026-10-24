// rule: rerender-functional-setstate
// verdict: pass
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read }) => {
  const [items, setItems] = useState([]);

  const handle = async () => {
    const files = [];
    for (let index = 0; index < files.length; index++) {
      await read();
    }
    setItems([...items, 1]);
  };
  return <input onChange={handle} />;
};
