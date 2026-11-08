// rule: debounce-no-cleanup
// verdict: fail
// weakness: wrapper-transparency
// source: authored equivalent-cleanup-body regression
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
  useEffect(() => {
    scheduled(query);
    return () => scheduled.cancel();
  }, [query, scheduled]);
  useEffect(
    () => () => {
      return scheduled(query);
    },
    [query, scheduled],
  );
  return null;
};
