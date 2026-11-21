// rule: exhaustive-deps
// weakness: covered-native-listener-closure
// source: paired window listener with a covered render capture
import { useEffect, useRef, useState } from "react";

export function Picker({
  mode,
  remember,
}: {
  mode: string;
  remember: (listener: EventListener) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const resetFocus = () => {
    field.current?.focus();
  };
  const handleEscape = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key === "Escape" && show) {
      setShow(false);
      resetFocus();
    }
  };
  useEffect(() => {
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [show]);
  return (
    <div>
      <input ref={field} />
      <button onClick={() => setShow(true)}>Open suggestions</button>
    </div>
  );
}
