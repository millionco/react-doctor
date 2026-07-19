import * as lodash from "lodash";
import { useEffect, useMemo } from "react";

const options = { trailing: false };

export const Search = ({ query }: { query: string }) => {
  const search = useMemo(
    () =>
      lodash[`debounce`](
        async (value: string) => {
          await fetchResults(value);
        },
        250,
        options,
      ),
    [],
  );
  useEffect(() => {
    options.trailing = true;
  }, []);
  useEffect(() => search(query), [query, search]);
  return null;
};

declare const fetchResults: (value: string) => Promise<void>;
