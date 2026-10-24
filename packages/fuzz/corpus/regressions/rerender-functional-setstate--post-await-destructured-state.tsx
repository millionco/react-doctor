// rule: rerender-functional-setstate
// verdict: pass
// weakness: alias-guard
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read, incoming }) => {
  let [items, setItems] = useState([]);
  ({ items } = { items: incoming });
  const handler = async () => {
    await read();
    setItems([...items, 1]);
  };
  return <button onClick={handler} />;
};
