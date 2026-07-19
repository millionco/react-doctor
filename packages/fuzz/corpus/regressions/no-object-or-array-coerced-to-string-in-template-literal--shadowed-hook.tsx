// rule: no-object-or-array-coerced-to-string-in-template-literal
// weakness: framework-gating
// source: adversarial audit of PR parsing/string-safety group

const useState = (_initialValue: unknown): [string] => ["safe"];

export const Label = () => {
  const [value] = useState({});
  return <span>{`${value}`}</span>;
};
