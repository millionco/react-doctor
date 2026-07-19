// rule: debounce-no-cleanup
// weakness: cleanup-call-proof
// source: PR #1000 deep adversarial audit
import { debounce } from "lodash";
import { useEffect, useMemo } from "react";

export const Search = () => {
  const search = useMemo(() => debounce(async () => fetch("/search"), 100), []);
  useEffect(() => {
    search();
    search.cancel;
  }, [search]);
  return null;
};
