// rule: query-no-query-in-effect
// weakness: deferred-render-write-order
// source: PR 1196 review audit

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export const Search = ({ customRefetch }: { customRefetch: () => void }) => {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    query.refetch();
  }, [query]);
  try {
    renderSearch();
  } catch {
    handleRenderError();
  } finally {
    query.refetch = customRefetch;
  }
  return null;
};
