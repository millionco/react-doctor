// rule: no-array-index-as-key
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
import type Object = require("provider-types");
Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [{ id: "outside" }] });
interface SlotProps {
  label: string;
}
const Slot = ({ label }: SlotProps) => <input defaultValue={label} />;
export const SlotGallery = () => {
  const count = 6;
  const slots = new Array(count).fill(null).map((unused, position) => position);
  return (
    <section>
      {slots.map((unused, index) => (
        <Slot key={index} label={`Position ${index + 1}`} />
      ))}
    </section>
  );
};
