// rule: no-pass-live-state-to-parent
// weakness: alias-guard
// source: Internxt useTrashPagination launch-day trial

import { useCallback, useEffect, useState } from "react";

export const useTrashPagination = ({ getTrashPaginated, setHasMoreItems, isTrash }) => {
  const [hasMoreTrashFolders] = useState(true);

  const getMoreTrashFiles = useCallback(async () => {
    const result = await getTrashPaginated();
    setHasMoreItems(result && !result.finished);
  }, [getTrashPaginated, setHasMoreItems]);

  const getMoreTrashItems = useCallback(() => {
    return hasMoreTrashFolders ? Promise.resolve() : getMoreTrashFiles();
  }, [hasMoreTrashFolders, getMoreTrashFiles]);

  useEffect(() => {
    if (!isTrash) return;
    const fetchInitialTrashItems = async () => {
      try {
        await getMoreTrashItems();
      } catch (error) {
        console.error(error);
      }
    };
    void fetchInitialTrashItems();
  }, [isTrash, getMoreTrashItems]);

  return { hasMoreTrashFolders };
};
