// rule: no-impure-state-updater
// weakness: library-idiom
// source: deep adversarial audit of PR #1175

import { useState } from "react";

const scheduler = {
  map: (callback: () => void) => () => callback(),
};

export const Counter = () => {
  const [count, setCount] = useState(0);
  const increment = () =>
    setCount((previousCount) => {
      const deferred = scheduler.map(() => localStorage.setItem("count", "1"));
      return previousCount + Number(Boolean(deferred));
    });
  return (
    <button type="button" onClick={increment}>
      {count}
    </button>
  );
};
