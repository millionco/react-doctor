// rule: exhaustive-deps
// weakness: other
// source: RD-FP-016 task-perfection addendum (Hightable, 2026-07-11)
import { useMemo, useRef } from "react";

export const Slice = ({ rows, cacheRevision }: { rows: string[]; cacheRevision: number }) => {
  const cacheRef = useRef(new Map<string, string[]>());

  return useMemo(() => {
    const cachedRows = cacheRef.current.get("rows");
    if (cachedRows) return cachedRows;
    cacheRef.current.set("rows", rows);
    return rows;
  }, [rows, cacheRevision]);
};
