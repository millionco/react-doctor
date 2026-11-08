// rule: debounce-no-cleanup
// verdict: pass
// weakness: alias-guard
// source: authored conservative compat lifetime regression

import { useEffect, useMemo } from "react";
import { debounce } from "es-toolkit/compat";

export const Search = ({ query }) => {
  const search = useMemo(
    () =>
      debounce(async () => {
        await fetch("/synthetic-search");
      }, 500),
    [],
  );
  const stop = search.cancel;
  search.cancel = () => {};
  useEffect(() => {
    search(query);
    return stop;
  }, [query, search]);
  return null;
};
