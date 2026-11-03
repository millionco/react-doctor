// rule: no-set-state-after-await-in-effect
// weakness: forwarded-setter
// source: Excalidraw library selection cleared in a microtask through a transparent setter helper
// verdict: fail
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface LibraryItemsProps {
  selectedItems: string[];
}

export const LibraryItems = ({ selectedItems }: LibraryItemsProps) => {
  const [lastSelectedItem, setLastSelectedItem] = useState<string | null>(null);

  useEffect(() => {
    if (selectedItems.length === 0) {
      queueMicrotask(() => assign(setLastSelectedItem, null));
    }
  }, [selectedItems]);

  return <output>{lastSelectedItem}</output>;
};
