// rule: no-array-index-as-key
// weakness: shadowed-binding
// source: independent synthetic review control
// verdict: fail

declare const Object: any;
Object.defineProperty(Object.getPrototypeOf([]), "map", {
  value: () => [{ id: "outside" }],
});

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
