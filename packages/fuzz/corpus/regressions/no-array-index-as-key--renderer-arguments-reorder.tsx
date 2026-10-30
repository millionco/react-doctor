// rule: no-array-index-as-key
// verdict: fail
// weakness: renderer-collection-alias
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
      {slots.map(function (value, index) {
        arguments[2].reverse();
        return <Slot key={index} label={String(value)} />;
      })}
    </section>
  );
};
