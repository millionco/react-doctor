import { useEffect, useState } from "react";

interface SearchResultProperties {
  loadQuery: (query: string) => Promise<string>;
  query: string;
}

export const SearchResult = ({ loadQuery, query }: SearchResultProperties) => {
  const [result, setResult] = useState("");

  useEffect(() => {
    let didLoseOwnership = false;
    void loadQuery(query).then((nextResult) => {
      if (!didLoseOwnership) setResult(nextResult);
    });
    return () => {
      didLoseOwnership = true;
    };
  }, [loadQuery, query]);

  return <output>{result}</output>;
};
