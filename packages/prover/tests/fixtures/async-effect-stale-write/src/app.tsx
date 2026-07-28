import { useEffect, useState } from "react";

interface SearchResultProperties {
  loadQuery: (query: string) => Promise<string>;
  query: string;
}

export const SearchResult = ({ loadQuery, query }: SearchResultProperties) => {
  const [result, setResult] = useState("");

  useEffect(() => {
    const loadResult = async () => {
      const nextResult = await loadQuery(query);
      setResult(nextResult);
    };
    void loadResult();
  }, [loadQuery, query]);

  return <output>{result}</output>;
};
