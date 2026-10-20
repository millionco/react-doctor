// rule: no-boolean-toggle-without-functional-update
// weakness: alias-guard
// source: Synthetic synchronous listener provider boundary
// verdict: pass
import { useEffect, useState } from "react";
export const Example = ({ mode, target }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let listener;
    if (mode) {
      listener = () => {};
    } else {
      listener = () => setOpen(!open);
    }
    target.addEventListener("change", listener);
    return () => target.removeEventListener("change", listener);
  }, [mode, target]);
  return <output>{String(open)}</output>;
};

const immediateTarget = {
  addEventListener(_event, callback) {
    callback();
  },
  removeEventListener() {},
};
export const Root = () => <Example mode={false} target={immediateTarget} />;
