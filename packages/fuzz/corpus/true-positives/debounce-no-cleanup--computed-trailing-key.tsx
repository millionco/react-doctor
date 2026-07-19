// rule: debounce-no-cleanup
// weakness: computed-option-key
// source: Cursor Bugbot review of PR #1365

import { useEffect, useMemo } from "react";
import { debounce } from "lodash";

export const Search = ({ query }: { query: string }): null => {
  const trailing = "leading";
  const search = useMemo(
    () => debounce(async (value: string) => fetchResults(value), 250, { [trailing]: false }),
    [],
  );
  useEffect(() => {
    search(query);
  }, [query, search]);
  return null;
};

declare const fetchResults: (query: string) => Promise<void>;
