// rule: no-array-index-as-key
// verdict: pass
// weakness: placeholder-index-provenance
// source: independent synthetic regression

interface SlotProps {
  label: string;
}
const Slot = ({ label }: SlotProps) => <input defaultValue={label} />;
export const SlotGallery = () => {
  const count = 6;
  const slots = new Array(count).fill(null).map((_unused, position) => position);
  return (
    <section>
      {slots.map((_unused, index) => (
        <Slot key={index} label={`Position ${index + 1}`} />
      ))}
    </section>
  );
};
