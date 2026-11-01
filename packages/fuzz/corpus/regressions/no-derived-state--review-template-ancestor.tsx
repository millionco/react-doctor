// rule: no-derived-state
// weakness: framework-gating
// source: independent synthetic PR review regression
// verdict: fail
import { useEffect, useRef, useState } from "react";
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
  return (
    <template>
      <button onClick={activate}>{String(value)}</button>
    </template>
  );
};
