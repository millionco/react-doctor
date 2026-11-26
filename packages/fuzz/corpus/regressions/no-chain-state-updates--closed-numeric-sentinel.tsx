import { useEffect, useRef, useState } from "react";

export function NumberedChoice({ pressed }) {
  const [position, setPosition] = useState(-1);
  const field = useRef(null);
  const finish = () => {
    const input = field.current;
    if (input) {
      input.focus();
      setPosition(-1);
    }
  };
  const advance = () => {
    const next = position < 5 ? position + 1 : position;
    setPosition(next);
  };
  useEffect(() => {
    if (pressed && position > -1) {
      finish();
    }
  }, [position, pressed]);
  return (
    <div>
      <button onClick={advance}>Next</button>
      <input ref={field} />
    </div>
  );
}
