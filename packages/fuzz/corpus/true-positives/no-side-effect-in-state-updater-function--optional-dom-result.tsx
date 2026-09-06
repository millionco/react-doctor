// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: synthetic native parity regression
import { useRef, useState } from "react";

export const Toggle = () => {
  const [wrapped, setWrapped] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const toggle = () =>
    setWrapped((previous) => {
      const element = elementRef.current?.closest(".code");
      if (element) element.setAttribute("data-wrapped", "true");
      return !previous;
    });
  return <button onClick={toggle}>{String(wrapped)}</button>;
};
