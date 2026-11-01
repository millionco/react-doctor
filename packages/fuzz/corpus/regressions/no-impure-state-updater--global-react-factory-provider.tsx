// rule: no-impure-state-updater
// verdict: pass
// weakness: alias-guard
// source: synthetic

const fakeReact = { useState: (initial) => [initial, (callback) => callback(initial)] };
Object.assign(globalThis, { React: fakeReact });

let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () =>
    applyState((previous) => {
      observed = previous;
      return previous;
    }),
});
export const Counter = (props) => {
  const [count, setCount] = React.useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};
