import { useCallback, useEffect, useRef, useState } from "react";

export function Picker() {
  const [position, setPosition] = useState(-1);
  const [expanded, setExpanded] = useState(true);
  const field = useRef<HTMLInputElement>(null);
  const finish = useCallback(() => {
    field.current?.focus();
    setPosition(-1);
  }, []);

  useEffect(() => {
    if (expanded && position !== -1) {
      setExpanded(false);
      finish();
    }
  }, [expanded, finish, position]);

  return (
    <>
      <input ref={field} aria-label="Selection search" />
      <button onClick={() => setPosition(0)} aria-expanded={expanded}>
        Choose
      </button>
    </>
  );
}
