// rule: query-no-query-in-effect
// weakness: mutation-call-provenance
// source: PR 1196 post-CI false-positive audit

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export const Search = ({ customRefetch }: { customRefetch: () => void }) => {
  const query = useQuery({ queryKey: ["items"] });
  Object.assign(query, { refetch: customRefetch });
  useEffect(() => {
    query.refetch();
  }, [query]);
  return null;
};
