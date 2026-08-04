import { useEffect, useRef } from "react";

interface SearchResultProperties {
  loadQuery: (query: string) => Promise<string>;
  query: string;
}

export const SearchResult = ({ loadQuery, query }: SearchResultProperties) => {
  const latestResult = useRef("");

  useEffect(() => {
    const loadResult = async () => {
      latestResult.current = await loadQuery(query);
    };
    void loadResult();
  }, [loadQuery, query]);

  return null;
};
