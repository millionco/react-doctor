// rule: button-has-type
// weakness: ast-shape
// source: cross-rule consistency audit (TS assertion wrappers around a provably valid type)
export const SaveButton = () => {
  const kind = "submit" as const;
  return <button type={kind}>Save</button>;
};
export const InlineSatisfiesButton = () => (
  <button type={"button" satisfies "button"}>Cancel</button>
);
