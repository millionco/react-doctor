// rule: no-nondeterministic-id-value-in-render-body
// weakness: name-heuristic
// source: adversarial audit 2026-07
const shortid = { generate: () => "stable-field-id" };

export const LocalField = () => {
  const fieldId = shortid.generate();
  return <label htmlFor={fieldId}>Name</label>;
};
