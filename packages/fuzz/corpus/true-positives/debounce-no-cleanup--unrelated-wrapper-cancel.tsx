// rule: debounce-no-cleanup
// weakness: alias-guard
// source: PR #1365 deep audit

import { debounce } from "lodash";

export const Search = () => {
  const search = useMemo(() => debounce(async () => fetch("/search"), 10), []);
  const wrapper = { search, cancel() {} };
  useEffect(() => {
    search();
    return () => wrapper.cancel();
  }, [search, wrapper]);
  return null;
};
