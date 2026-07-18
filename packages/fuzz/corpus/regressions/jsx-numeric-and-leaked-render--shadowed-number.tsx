// rule: jsx-numeric-and-leaked-render
// weakness: name-heuristic
// source: adversarial audit of render/data-safety rules
const Number = (value: unknown) => Boolean(value);

export const Badge = ({ value }: { value: unknown }) => (
  <div>{Number(value) && <span>Ready</span>}</div>
);
