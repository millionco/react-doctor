// rule: query-no-query-in-effect
// weakness: receiver-provenance
// source: ISSUES_TO_FIX_ASAP V28b minimized reproduction

import { useEffect } from "react";

interface SearchIndex {
  refetch: () => void;
}

export const Search = ({ index }: { index: SearchIndex }) => {
  useEffect(() => {
    index.refetch();
  }, [index]);
  return null;
};
