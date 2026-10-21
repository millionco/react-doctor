// rule: no-derived-state
// weakness: library-idiom
// verdict: pass
// source: synthetic native event writer regression
import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  // oxlint-disable-next-line react/refs -- regression requires writer storage
  latest.current = { writeValue };
  const activate = (event) => {
    event.preventDefault();
    writeValue(!value);
  };
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- regression requires prop reseeding
    setValue(seed);
  }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};
