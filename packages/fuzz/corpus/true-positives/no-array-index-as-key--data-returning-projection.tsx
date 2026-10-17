// rule: no-array-index-as-key
// verdict: fail
// weakness: placeholder-index-provenance
// source: independent synthetic regression

interface SlotProps {
  label: string;
}
const Slot = ({ label }: SlotProps) => <input defaultValue={label} />;
interface GalleryProps {
  rows: SlotProps[];
}
export const SlotGallery = ({ rows }: GalleryProps) => {
  const count = 6;
  const slots = new Array(count).fill(null).map((_unused, position) => rows[position]);
  return (
    <section>
      {slots.map((row, index) => (
        <Slot key={index} label={row.label} />
      ))}
    </section>
  );
};
