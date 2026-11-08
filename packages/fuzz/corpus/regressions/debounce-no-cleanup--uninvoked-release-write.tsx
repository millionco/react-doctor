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
  const neverCalled = () => {
    search.cancel = () => {};
  };
  void neverCalled;
  useEffect(() => {
    search(query);
    return () => search.cancel();
  }, [query, search]);
  return null;
};
