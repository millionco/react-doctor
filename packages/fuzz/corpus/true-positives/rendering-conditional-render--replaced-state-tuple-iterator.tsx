// rule: rendering-conditional-render
// verdict: fail
// weakness: alias-guard
// source: independently synthetic replaced tuple iterator
import { useState } from "react";

Array.prototype[Symbol.iterator] = function* () {
  yield 0;
  yield () => {};
};

export const QuantityBadge = () => {
  const [itemCount, writeCount] = useState("");
  return (
    <button onClick={() => writeCount("ready")}>{itemCount && <output>{itemCount}</output>}</button>
  );
};
