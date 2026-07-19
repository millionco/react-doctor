// rule: no-object-keys-values-entries-on-maybe-undefined
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (table columns: a length early-return proves rows?.[0] is a defined element)
import { useMemo } from "react";

export const useColumns = (data?: { data?: Record<string, unknown>[] }) => {
  return useMemo(() => {
    const rows = data?.data ?? [];
    if (rows.length === 0) {
      return [];
    }
    return Object.keys(rows?.[0]).map((key) => ({ dataKey: key }));
  }, [data?.data]);
};
