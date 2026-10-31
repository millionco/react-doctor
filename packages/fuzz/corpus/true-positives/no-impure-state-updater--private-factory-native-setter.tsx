// rule: no-impure-state-updater
// weakness: private-factory-native-setter-provenance
// verdict: fail
// source: synthetic
import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, _configuration) => ({
  onClick: () =>
    applyState((previous) => {
      observed = previous;
      return previous;
    }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return (
    <button {...createHandlers(setCount, props.config)}>
      {count}:{observed}
    </button>
  );
};
