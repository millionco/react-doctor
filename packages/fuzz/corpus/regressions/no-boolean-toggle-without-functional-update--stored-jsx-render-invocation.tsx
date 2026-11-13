// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: synthetic source-boundary regression
import { useEffect, useState } from "react";
export const Example = ({ target }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(true);
  const button = <button onClick={() => setMode(false)} />;
  if (mode) button.props.onClick();
  useEffect(() => {
    let listener;
    if (mode) {
      listener = () => setOpen(!open);
    } else {
      listener = () => {};
    }
    target.addEventListener("change", listener);
    return () => target.removeEventListener("change", listener);
  });
  return button;
};
