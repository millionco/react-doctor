import { useEffect, useRef, useState } from "react";

export function ChoiceField({ pressed }) {
  const [position, setPosition] = useState(-1);
  const field = useRef(null);
  const finish = () => {
    const input = field.current;
    if (input) {
      input.focus();
      setPosition(-1);
    }
  };
  useEffect(() => {
    if (pressed) {
      if (position === -1) {
        return;
      }
      finish();
    }
  }, [position, pressed]);
  return (
    <div>
      <button onClick={() => setPosition(0)}>Choose</button>
      <input ref={field} />
    </div>
  );
}
