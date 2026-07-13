// rule: query-no-query-in-effect
// weakness: receiver-provenance
// source: ISSUES_TO_FIX_ASAP V28b minimized reproduction

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface SearchIndex {
  refetch: () => void;
}

export const Search = ({ index }: { index: SearchIndex }) => {
  const query = useQuery({ queryKey: ["items"], queryFn: async () => [] });
  useEffect(() => {
    index.refetch();
    query.refetch();
  }, [index, query]);
  return null;
};
