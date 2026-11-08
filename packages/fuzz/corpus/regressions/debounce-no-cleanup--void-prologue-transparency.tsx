// rule: debounce-no-cleanup
// verdict: fail
// weakness: wrapper-transparency
// source: authored inert-prologue regression
import { useEffect, useMemo } from "react";
import { debounce } from "es-toolkit/compat";
export const Search = ({ query }) => {
  const scheduled = useMemo(() => {
    void 0;
    return debounce(async () => {
      void 0;
      await fetch("/synthetic-search");
    }, 250);
  }, []);
  useEffect(() => {
    void 0;
    scheduled(query);
  }, [query, scheduled]);
  return null;
};
