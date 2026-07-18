// rule: no-fill-map-element-as-key
// weakness: control-flow
export const Slots = () => {
  const slots = Array(3).fill(null);
  console.log(slots);
  return slots.map((item) => <span key={item} />);
};
