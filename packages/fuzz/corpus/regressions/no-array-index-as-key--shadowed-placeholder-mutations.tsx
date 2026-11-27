import { useState } from "react";

interface PlaceholderRowProps {
  value: unknown;
}

const PlaceholderRow = ({ value }: PlaceholderRowProps) => {
  const [selected, setSelected] = useState(false);
  return (
    <button onClick={() => setSelected(!selected)}>
      {String(value)}:{String(selected)}
    </button>
  );
};

export const makeUnrelatedRows = () => {
  const slots: string[] = [];
  slots.push("ordinary row");
  return slots;
};

export const PlaceholderRows = () => {
  const slots = Array.from({ length: 3 });
  return (
    <div>
      {slots.map((value, index) => (
        <PlaceholderRow key={index} value={value} />
      ))}
    </div>
  );
};
