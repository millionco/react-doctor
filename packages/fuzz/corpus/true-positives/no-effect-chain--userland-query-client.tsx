// rule: no-effect-chain
// weakness: provenance
// source: React Bench t3code paired control

import { useCallback, useEffect, useState } from "react";

interface UserlandQueryClientProps {
  query: string;
  queryClient: {
    prefetchQuery: (query: string) => void;
  };
}

export const UserlandQueryClient = ({ query, queryClient }: UserlandQueryClientProps) => {
  const [activeQuery, setActiveQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const prefetch = useCallback(() => {
    queryClient.prefetchQuery(activeQuery);
  }, [activeQuery, queryClient]);

  useEffect(() => setActiveQuery(query), [query]);
  useEffect(() => {
    prefetch();
    setStatus("ready");
  }, [activeQuery, prefetch]);

  return status;
};
