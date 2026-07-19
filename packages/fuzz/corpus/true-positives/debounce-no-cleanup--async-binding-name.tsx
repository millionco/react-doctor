// rule: debounce-no-cleanup
// weakness: name-heuristic
// source: Cursor Bugbot review of PR #1365

import { useEffect, useMemo } from "react";
import { debounce } from "lodash";

export const Search = ({ query }: { query: string }): null => {
  const asyncSearch = useMemo(
    () => debounce(async () => fetch(`/search?q=${query}`), 250),
    [query],
  );
  useEffect(() => {
    asyncSearch();
  }, [asyncSearch]);
  return null;
};
