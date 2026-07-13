// rule: query-no-query-in-effect
// weakness: execution-context-order
// source: PR 1196 final false-negative audit

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export const Search = ({ customRefetch }: { customRefetch: () => void }) => {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => {
    query.refetch = customRefetch;
  };
  useEffect(() => {
    query.refetch();
  }, [query]);
  return <button onClick={overwriteRefetch}>Reload</button>;
};
