import { useEffect, useRef, useState } from "react";

export function Selection({ confirm }) {
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
    if (confirm && position !== -1) {
      setExpanded(false);
      returnFocus();
    }
  }, [confirm, position]);

  return (
    <div>
      <button onClick={() => setPosition(0)} aria-expanded={expanded}>
        Choose
      </button>
      <input ref={input} />
    </div>
  );
}
