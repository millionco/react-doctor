// rule: no-prop-types
// weakness: name-heuristic
// source: adversarial review of component receiver provenance

export const Schema = (value: string, options: { children: unknown }) => options.children;

Schema.propTypes = { value: () => true };
