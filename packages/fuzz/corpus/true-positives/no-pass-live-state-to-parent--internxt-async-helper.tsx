// rule: no-pass-live-state-to-parent
// verdict: fail
// weakness: alias-guard
// source: React Bench Internxt useTrashPagination representative trial 2UPR6Vm

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
