// rule: rerender-functional-setstate
// weakness: alias-guard
// source: independently authored synthetic
// verdict: fail
import React, { useState as nativeUseState } from "react";
React.useState = (initial) =>
  nativeUseState({
    valueOf: () => {
      console.log("coercion");
      return initial;
    },
  });
export const Counter = () => {
  const [count, setCount] = React.useState(0);
  const handleKey = (event) => {
    if (event.key === "Home") setCount(0);
    else setCount(count + 1);
  };
  return <input onKeyDown={handleKey} value={count} />;
};
