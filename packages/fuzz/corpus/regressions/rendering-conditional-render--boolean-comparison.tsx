// rule: rendering-conditional-render
// weakness: name-heuristic
// verdict: pass
export const Counter = ({ value }) => {
  const atMaxLength = value.length === 10;
  return <div>{atMaxLength && <span>Full</span>}</div>;
};
