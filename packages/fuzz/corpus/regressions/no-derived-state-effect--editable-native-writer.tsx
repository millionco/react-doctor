// rule: no-derived-state-effect
// weakness: control-flow
// source: independent synthetic editable native state companion regression
// verdict: pass
import { useEffect, useRef, useState } from "react";

export const EditablePanel = ({ seed }) => {
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
