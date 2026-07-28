import { useEffect, useState } from "react";

interface SearchResultProperties {
  isCurrentQuery: (query: string) => boolean;
  loadQuery: (query: string) => Promise<string>;
  query: string;
}

export const SearchResult = ({ isCurrentQuery, loadQuery, query }: SearchResultProperties) => {
  const [result, setResult] = useState("");

  useEffect(() => {
    const loadResult = async () => {
      const nextResult = await loadQuery(query);
      if (isCurrentQuery(query)) setResult(nextResult);
    };
    void loadResult();
  }, [isCurrentQuery, loadQuery, query]);

  return <output>{result}</output>;
};
