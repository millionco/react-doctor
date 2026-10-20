// rule: no-impure-state-updater
// weakness: transparent-direct-eval-parameter-write
// verdict: pass
// source: synthetic
import { useState } from "react";
let observed = 0;
const makeHandler = (setValue) => {
  // oxlint-disable-next-line no-eval -- regression seed for transparent direct eval
  (eval as any)("setValue = updater => updater(0)");
  return () =>
    setValue((previous) => {
      observed += 1;
      return previous;
    });
};
export const Example = () => {
  const [value, setValue] = useState(0);
  const onClick = makeHandler(setValue);
  return (
    <button onClick={onClick}>
      {value}:{observed}
    </button>
  );
};
