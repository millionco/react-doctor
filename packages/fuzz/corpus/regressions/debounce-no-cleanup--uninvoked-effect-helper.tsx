// rule: debounce-no-cleanup
// source: Cursor Bugbot review of PR #1365

import { useEffect, useMemo } from "react";
import { debounce } from "lodash";

export const Search = ({ query }: { query: string }): null => {
  const search = useMemo(() => debounce(runSearch, 250), []);
  useEffect(() => {
    const runDebugSearch = () => search(query);
    registerDebugHelper(runDebugSearch);
  }, [query, search]);
  return null;
};

declare const registerDebugHelper: (helper: () => void) => void;
declare const runSearch: (query: string) => void;
