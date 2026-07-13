// rule: no-prop-types
// weakness: control-flow
// source: adversarial review of component receiver provenance

export const Schema = (items: string[]) => {
  items.map((item) => <div key={item}>{item}</div>);
  return { count: items.length };
};

Schema.propTypes = { value: () => true };
