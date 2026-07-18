// rule: debounce-no-cleanup
// weakness: alias-ownership-transfer
// source: PR #1365 Cursor Bugbot
import debounce from "lodash/debounce";
import { useEffect, useMemo } from "react";

export const useSearch = () => {
  const search = useMemo(() => debounce(() => (document.title = "late"), 100), []);
  const exposedSearch = search;
  useEffect(() => exposedSearch(), [exposedSearch]);
  return exposedSearch;
};
