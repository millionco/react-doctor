import { useEffect, useState } from "react";

declare const registerStateSetter: (setter: (nextValue: number) => void) => void;

export const Counter = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    registerStateSetter(setCount);
  }, [setCount]);

  return <output>{count}</output>;
};
