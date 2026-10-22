// rule: hook-use-state
// weakness: dynamic-computed
// source: independently authored numeric data and listener example
// verdict: pass
import { useEffect, useState } from "react";

export const NumericPanel = ({ rawIndex }) => {
  const [storedKey] = useState(7);
  const getIndex = (value) => Number(value);
  const updateValues = (position) => {
    const values = [3, 7];
    values[position] = 8;
    const previousValue = values[position];
    values.reverse();
    return values.indexOf(previousValue);
  };
  const amount = updateValues(getIndex(rawIndex));
  useEffect(() => {
    const listener = () => {
      void amount;
    };
    window.addEventListener("sample", listener);
    return () => window.removeEventListener("sample", listener);
  }, [amount]);
  return <span>{storedKey + amount}</span>;
};
