// rule: no-effect-chain
// weakness: provenance
// source: React Bench Payload LexicalMenu

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

interface StableCallbackOpaqueSelectionSyncProps {
  editor: {
    getRootElement: () => { setAttribute: (name: string, value: string) => void } | null;
  };
  groups: { items: { key: string }[] }[] | null;
  source: string;
}

export const StableCallbackOpaqueSelectionSync = ({
  editor,
  groups,
  source,
}: StableCallbackOpaqueSelectionSyncProps) => {
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const updateSelectedItem = useCallback(
    (item: { key: string }) => {
      const rootElement = editor.getRootElement();
      if (rootElement !== null) {
        rootElement.setAttribute("aria-activedescendant", `item-${item.key}`);
        setSelectedItemKey(item.key);
      }
    },
    [editor],
  );
  const selectFirstItem = useCallback(() => {
    const allItems = groups?.flatMap((group) => group.items) ?? [];
    const firstItem = allItems[0];
    if (firstItem) updateSelectedItem(firstItem);
  }, [groups, updateSelectedItem]);

  useEffect(() => selectFirstItem(), [selectFirstItem, source]);
  useLayoutEffect(() => {
    if (groups === null) setSelectedItemKey(null);
    else if (selectedItemKey === null) selectFirstItem();
  }, [groups, selectFirstItem, selectedItemKey]);

  return selectedItemKey;
};
