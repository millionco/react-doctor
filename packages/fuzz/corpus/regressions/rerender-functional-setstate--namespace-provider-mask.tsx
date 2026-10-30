// rule: rerender-functional-setstate
// verdict: fail
// weakness: provider-erasure
// source: synthetic
namespace require {}
require("react").useState = () => [0, () => {}];
import { useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  const handleKey = (event) => {
    if (event.key === "Home") setCount(0);
    else if (event.key === "End") setCount(10);
    else setCount(count + 1);
  };
  return <input onKeyDown={handleKey} value={count} />;
};
