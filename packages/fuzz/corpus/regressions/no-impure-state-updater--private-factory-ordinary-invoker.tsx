// rule: no-impure-state-updater
// weakness: private-factory-ordinary-invoker
// verdict: pass
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
  const [count, _setCount] = useState(0);
  return (
    <button {...createHandlers((callback) => callback(count), props.config)}>
      {count}:{observed}
    </button>
  );
};
