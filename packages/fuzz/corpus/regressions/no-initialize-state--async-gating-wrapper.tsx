// rule: no-initialize-state
// weakness: control-flow
// source: internxt/drive-web@3f96ab4 src/views/Trash/hooks/useTrashPagination.ts

import { useCallback, useEffect, useState } from "react";

interface PageResult {
  finished: boolean;
}

interface UseRemotePaginationOptions {
  isEnabled: boolean;
  loadPage: () => Promise<PageResult>;
}

export const useRemotePagination = ({ isEnabled, loadPage }: UseRemotePaginationOptions) => {
  const [hasMorePages, setHasMorePages] = useState(true);

  const loadNextPage = useCallback(async () => {
    const result = await loadPage();
    setHasMorePages(!result.finished);
  }, [loadPage]);

  const dispatchPageLoad = useCallback(() => {
    return hasMorePages ? loadNextPage() : Promise.resolve();
  }, [hasMorePages, loadNextPage]);

  useEffect(() => {
    if (isEnabled) {
      void dispatchPageLoad();
    }
  }, []);

  return hasMorePages;
};
