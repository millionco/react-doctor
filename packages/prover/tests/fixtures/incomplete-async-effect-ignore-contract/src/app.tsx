import { useEffect, useState } from "react";

interface SearchResultProperties {
  loadQuery: (query: string) => Promise<string>;
  query: string;
}

export const SearchResult = ({ loadQuery, query }: SearchResultProperties) => {
  const [result, setResult] = useState("");

  useEffect(() => {
    let didLoseOwnership = false;
    const loadResult = async () => {
      const nextResult = await loadQuery(query);
      if (!didLoseOwnership) setResult(nextResult);
    };
    void loadResult();
    return () => {
      didLoseOwnership = true;
    };
  }, [loadQuery, query]);

  return <output>{result}</output>;
};
