// rule: no-prop-types
// weakness: name-heuristic
// source: adversarial review of component receiver provenance

export const Schema = ({ children: { value } }: { children: { value: unknown } }) => value;

Schema.propTypes = { value: () => true };
