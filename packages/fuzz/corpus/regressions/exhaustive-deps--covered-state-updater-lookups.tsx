import { useEffect, useState } from "react";

type Item = { visible: boolean };
export function ListSelection({
  itemsById,
}: {
  itemsById: Map<string, Item> | Record<string, Item>;
}) {
  const [selected, setSelected] = useState(() => new Set<string>());
  const readItem = (key: string) =>
    itemsById instanceof Map ? itemsById.get(key) : itemsById?.[key];
  useEffect(() => {
    setSelected((previous) => {
      const next = new Set<string>();
      let changed = false;
      previous.forEach((key) => {
        const item = readItem(key);
        if (item?.visible) next.add(key);
        else changed = true;
      });
      return changed ? next : previous;
    });
  }, [itemsById]);
  return (
    <div>
      {["sample"].map((key) => (
        <span key={key}>
          {String(readItem(key)?.visible)} {selected.size}
        </span>
      ))}
    </div>
  );
}
