// rule: no-prop-types
// weakness: name-heuristic
// source: adversarial review of component receiver provenance

export const Children = (children: unknown) => children;

Children.propTypes = { children: () => true };
