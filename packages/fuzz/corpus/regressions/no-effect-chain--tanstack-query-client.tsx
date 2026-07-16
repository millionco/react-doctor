// rule: no-effect-chain
// weakness: provenance
// source: React Bench t3code pinned regression

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

interface TanStackQueryClientProps {
  query: string;
}

export const TanStackQueryClient = ({ query }: TanStackQueryClientProps) => {
  const [activeQuery, setActiveQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const queryClient = useQueryClient();
  const prefetch = useCallback(() => {
    void queryClient.prefetchQuery({ queryKey: ["search", activeQuery] });
  }, [activeQuery, queryClient]);

  useEffect(() => setActiveQuery(query), [query]);
  useEffect(() => {
    prefetch();
    setStatus("ready");
  }, [activeQuery, prefetch]);

  return status;
};
