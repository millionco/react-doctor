// rule: no-prop-callback-in-effect
// verdict: pass
import { useEffect, useRef, useState } from "react";

export function Action({ notify }: { notify: (value: string) => void }) {
  const [pressed, setPressed] = useState(false);
  const [value, setValue] = useState("");
  const previous = useRef(false);

  useEffect(() => {
    const rising = pressed && !previous.current;
    if (rising) notify(value);
    previous.current = pressed;
  }, [notify, pressed, value]);

  return (
    <button
      onClick={() => {
        setPressed(!pressed);
        setValue("next");
      }}
    >
      {value}
    </button>
  );
}
