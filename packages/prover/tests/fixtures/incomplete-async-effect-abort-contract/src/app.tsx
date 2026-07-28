import { useEffect, useState } from "react";

interface SearchResultProperties {
  loadQuery: (query: string, signal: AbortSignal) => Promise<string>;
  query: string;
}

export const SearchResult = ({ loadQuery, query }: SearchResultProperties) => {
  const [result, setResult] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadResult = async () => {
      const nextResult = await loadQuery(query, controller.signal);
      if (!controller.signal.aborted) setResult(nextResult);
    };
    void loadResult();
    return () => {
      controller.abort();
    };
  }, [loadQuery, query]);

  return <output>{result}</output>;
};
