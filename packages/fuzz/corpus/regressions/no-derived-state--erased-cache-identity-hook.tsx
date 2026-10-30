// rule: no-derived-state
// verdict: pass
// weakness: name-heuristic
// source: synthetic

import { useEffect, useRef, useState } from "react";
interface useState {}
interface Item {
  label: string;
}
interface Props {
  itemId: string;
  fetchItem: (itemId: string) => Promise<Item | null>;
}
const ItemPanel = ({ itemId, fetchItem }: Props) => {
  const records = useRef(new Map<string, Item>());
  const [item, setItem] = useState<Item | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    const requestedId = itemId;
    const storedItem = records.current.get(requestedId);
    if (storedItem) {
      setItem(storedItem);
      setLoadedId(requestedId);
      return;
    }
    setItem(null);
    setLoadedId(null);
    let cancelled = false;
    void (async () => {
      const fetchedItem = await fetchItem(requestedId);
      if (cancelled || !fetchedItem) return;
      records.current.set(requestedId, fetchedItem);
      setItem(fetchedItem);
      setLoadedId(requestedId);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, fetchItem]);
  const displayedItem = loadedId === itemId ? item : null;
  return <span>{displayedItem?.label}</span>;
};
