// rule: no-derived-state-effect
// weakness: framework-gating
// source: independent synthetic inactive native state companion regression
// verdict: fail
import { useEffect, useRef, useState } from "react";

export const InactivePanel = ({ seed }) => {
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
    <noscript>
      <button onClick={activate}>{String(value)}</button>
    </noscript>
  );
};
