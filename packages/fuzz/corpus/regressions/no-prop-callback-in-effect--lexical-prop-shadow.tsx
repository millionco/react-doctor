// rule: no-prop-callback-in-effect
// verdict: pass
// weakness: alias-guard
// source: synthetic local callback shadows a parent prop
import { useEffect, useState } from "react";

const record = (value: number) => console.info(value);

export const Widget = ({ onChange }: { onChange: (value: number) => void }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const onChange = record;
    onChange(count);
  }, [count]);
  const handleClick = () => {
    const nextCount = count + 1;
    setCount(nextCount);
    onChange(nextCount);
  };
  return <button onClick={handleClick}>{count}</button>;
};
