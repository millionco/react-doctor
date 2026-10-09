// rule: no-array-index-as-key
// verdict: pass
// weakness: key aliases lost the numeric placeholder counter binding
// source: reduced local regression
export const Slots = ({ count }) => {
  const slots = [];
  for (let index = 0; index < count; index++) {
    const slotKey = `slot-${index}`;
    slots.push(<Placeholder key={slotKey} />);
  }
  return slots;
};
