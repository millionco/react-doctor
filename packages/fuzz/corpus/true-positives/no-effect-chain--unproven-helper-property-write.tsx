// rule: no-effect-chain
// weakness: provenance
// source: React Bench Payload conservative control

import { useEffect, useLayoutEffect, useState } from "react";

interface MenuItem {
  key: string;
}

interface UnprovenHelperPropertyWriteProps {
  items: MenuItem[];
  query: string;
}

export const UnprovenHelperPropertyWrite = ({ items, query }: UnprovenHelperPropertyWriteProps) => {
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const updateSelectedItem = (item: MenuItem) => {
    setSelectedItemKey(item.key);
  };
  const selectFirstItem = () => {
    const item = items[0];
    if (item) updateSelectedItem(item);
  };

  useEffect(() => selectFirstItem(), [query, selectFirstItem]);
  useLayoutEffect(() => {
    if (items.length === 0) setSelectedItemKey(null);
    else if (selectedItemKey === null) selectFirstItem();
  }, [items, selectFirstItem, selectedItemKey]);

  return selectedItemKey;
};
