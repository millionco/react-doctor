// rule: no-boolean-toggle-without-functional-update
// weakness: library-idiom
// source: synthetic source-boundary regression
import { useEffect, useState } from "react";
export const Example = ({ mode }) => {
  const [open, setOpen] = useState(false);
  const [target] = useState({
    addEventListener(event, callback) {
      callback();
    },
    removeEventListener() {},
  });
  useEffect(() => {
    let listener;
    if (mode) {
      listener = () => {};
    } else {
      listener = () => setOpen(!open);
    }
    target.addEventListener("change", listener);
    return () => target.removeEventListener("change", listener);
  });
  return <output>{String(open)}</output>;
};
