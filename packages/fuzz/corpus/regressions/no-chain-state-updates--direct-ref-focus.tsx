import { useEffect, useRef, useState } from "react";

export function Selection() {
  const [position, setPosition] = useState(-1);
  const [expanded, setExpanded] = useState(true);
  const input = useRef(null);
  const returnFocus = () => {
    if (input.current) {
      input.current.focus();
      setPosition(-1);
    }
  };

  useEffect(() => {
    if (position !== -1) {
      setExpanded(false);
      returnFocus();
    }
  }, [position]);

  return (
    <div>
      <button onClick={() => setPosition(0)} aria-expanded={expanded}>
        Choose
      </button>
      <input ref={input} aria-label="Selection search" />
    </div>
  );
}
