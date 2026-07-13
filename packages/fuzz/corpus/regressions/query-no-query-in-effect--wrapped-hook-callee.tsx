// rule: query-no-query-in-effect
// weakness: wrapped-hook-callee-provenance
// source: PR #1196 review

import * as ReactQuery from "@tanstack/react-query";
import { useEffect } from "react";

export const Search = () => {
  const query = (ReactQuery as typeof ReactQuery)[`useQuery`]({ queryKey: ["items"] });
  useEffect(() => {
    query.refetch();
  }, [query]);
  return null;
};
