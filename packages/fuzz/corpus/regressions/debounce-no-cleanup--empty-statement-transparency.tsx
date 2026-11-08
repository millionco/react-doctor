// rule: debounce-no-cleanup
// verdict: fail
// weakness: wrapper-transparency
// source: authored inert-statement regression
import { useEffect, useMemo } from "react";
import { debounce } from "es-toolkit/compat";
export const Search = ({ query }) => {
  const scheduled = useMemo(
    () =>
      debounce(async () => {
        await fetch("/synthetic-search");
      }, 250),
    [],
  );
  // HACK: Keep the inert statement and receiver wrapper as regression syntax.
  // prettier-ignore
  useEffect(() => { ; (scheduled).cancel(); scheduled(query); }, [query, scheduled]);
  return null;
};
