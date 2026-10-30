// rule: no-derived-state
// weakness: name-heuristic
// source: independent synthetic PR review regression
// verdict: pass
import { useEffect, useRef, useState } from "react";
interface useState {}
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => {
    event.preventDefault();
    writeValue(!value);
  };
  useEffect(() => {
    setValue(seed);
  }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};
