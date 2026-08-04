import { useState } from "react";

const items = [
  { id: "first", label: "First" },
  { id: "second", label: "Second" },
];

const selectItem = (itemId: string) => itemId;

export const ItemList = () => {
  const [selectedItemId, setSelectedItemId] = useState("");
  return (
    <section>
      <p>{selectedItemId}</p>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => setSelectedItemId(selectItem(item.id))}>
          {item.label}
        </button>
      ))}
    </section>
  );
};
