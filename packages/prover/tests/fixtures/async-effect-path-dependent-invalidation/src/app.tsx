import { useEffect, useState } from "react";

interface SearchResultProperties {
  loadQuery: (query: string) => Promise<string>;
  query: string;
  skipInvalidation: boolean;
}

export const SearchResult = ({ loadQuery, query, skipInvalidation }: SearchResultProperties) => {
  const [result, setResult] = useState("");

  useEffect(() => {
    let didLoseOwnership = false;
    const loadResult = async () => {
      const nextResult = await loadQuery(query);
      if (!didLoseOwnership) setResult(nextResult);
    };
    void loadResult();
    if (skipInvalidation) return () => {};
    return () => {
      didLoseOwnership = true;
    };
  }, [loadQuery, query, skipInvalidation]);

  return <output>{result}</output>;
};
