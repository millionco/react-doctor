// rule: no-fill-map-element-as-key
// weakness: control-flow
// source: adversarial audit of render/data-safety rules
export const Empty = () =>
  Array(0)
    .fill(null)
    .map((item) => <span key={item} />);
