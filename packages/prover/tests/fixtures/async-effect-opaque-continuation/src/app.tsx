import { useEffect } from "react";

interface SearchResultProperties {
  commitResult: (result: string) => void;
  loadQuery: (query: string) => Promise<string>;
  query: string;
}

export const SearchResult = ({ commitResult, loadQuery, query }: SearchResultProperties) => {
  useEffect(() => {
    void loadQuery(query).then(commitResult);
  }, [commitResult, loadQuery, query]);

  return null;
};
