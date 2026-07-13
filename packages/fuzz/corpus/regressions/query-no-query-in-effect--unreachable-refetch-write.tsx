// rule: query-no-query-in-effect
// weakness: write-reachability
// source: PR 1196 post-CI false-negative audit

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export const Search = ({ customRefetch }: { customRefetch: () => void }) => {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => {
    return;
    // oxlint-disable-next-line no-unreachable -- regression seed for unreachable provenance writes
    query.refetch = customRefetch;
  };
  useEffect(() => {
    overwriteRefetch();
    query.refetch();
  });
  return null;
};
