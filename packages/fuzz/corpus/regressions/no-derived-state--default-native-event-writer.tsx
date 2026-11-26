import { useEffect, useRef, useState } from "react";

export const Disclosure = ({ seed, as: Host = "div", ...rest }) => {
  const [open, setOpen] = useState(seed);
  const writeOpen = (next: boolean) => setOpen(next);
  const latest = useRef({ writeOpen });
  latest.current = { writeOpen };
  const toggle = (event: { preventDefault(): void }) => {
    event.preventDefault();
    writeOpen(!open);
  };
  useEffect(() => {
    setOpen(seed);
  }, [seed]);
  return (
    <Host {...rest}>
      <button onClick={toggle}>{String(open)}</button>
    </Host>
  );
};
