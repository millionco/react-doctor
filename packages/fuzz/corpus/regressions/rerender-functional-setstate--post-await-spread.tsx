// rule: rerender-functional-setstate
// verdict: fail
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read }) => {
  const [items, setItems] = useState([]);
  const handler = async () => {
    const received = await read();
    setItems([...items, received]);
  };
  return <button onClick={handler} />;
};
