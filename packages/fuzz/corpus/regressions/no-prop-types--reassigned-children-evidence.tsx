// rule: no-prop-types
// weakness: stale-binding-provenance
// source: adversarial review of direct children component evidence

export const Schema = ({ children }: { children: unknown }) => {
  children = { value: true };
  return children;
};

Schema.propTypes = { children: () => true };
