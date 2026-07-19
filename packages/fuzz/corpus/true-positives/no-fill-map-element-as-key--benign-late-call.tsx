// rule: no-fill-map-element-as-key
// weakness: control-flow
export const Slots = () => {
  const slots = Array(3).fill(null);
  const output = slots.map((item) => <span key={item} />);
  console.log(slots);
  return output;
};
