// rule: rerender-functional-setstate
// verdict: pass
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read }) => {
  const [items, setItems] = useState([]);
  const handler = async (flag, other) => {
    if (flag && other) await read();
    if (flag) return;
    setItems([...items, 1]);
  };
  return <button onClick={handler} />;
};
