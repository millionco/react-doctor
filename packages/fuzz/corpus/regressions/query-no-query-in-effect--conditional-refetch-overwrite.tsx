// rule: query-no-query-in-effect
// weakness: expression-level-conditional-write
// source: PR #1196 review

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export const Search = ({
  customRefetch,
  shouldOverwrite,
}: {
  customRefetch: () => void;
  shouldOverwrite: boolean;
}) => {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    query.refetch();
  }, [query]);
  const didOverwrite = shouldOverwrite && (query.refetch = customRefetch);
  void didOverwrite;
  return null;
};
