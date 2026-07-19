import * as lodash from "lodash";
import { useEffect, useMemo } from "react";

export const CastLodashNamespace = ({ query }: { query: string }) => {
  const search = useMemo(
    () => (lodash as typeof lodash).debounce((value: string) => fetch(`/search?q=${value}`), 250),
    [],
  );
  useEffect(() => search(query), [query, search]);
  return null;
};
