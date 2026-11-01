// rule: jsx-handler-names
// weakness: name-heuristic
// source: synthetic regression
// verdict: pass
export const Action = (input: { onClick: () => void }) => (
  <button onClick={input.onClick}>Continue</button>
);
