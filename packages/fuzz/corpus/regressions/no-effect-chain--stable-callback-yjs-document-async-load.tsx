// rule: no-effect-chain
// weakness: cross-file
// source: React Bench AppFlowy-Web relation rows

import { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";
import { useDatabaseContextOptional } from "@/application/database-yjs";

interface StableCallbackYjsDocumentAsyncLoadProps {
  cell: { data?: unknown } | null;
}

export const StableCallbackYjsDocumentAsyncLoad = ({
  cell,
}: StableCallbackYjsDocumentAsyncLoadProps) => {
  const context = useDatabaseContextOptional();
  const createRow = context?.createRow;
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [rows, setRows] = useState<object[]>([]);
  const handleUpdateRowIds = useCallback(() => {
    const data = cell?.data;
    if (!data || !(data instanceof Y.Array)) {
      setRowIds([]);
      return;
    }
    setRowIds(data.toJSON());
  }, [cell?.data]);

  useEffect(() => {
    if (!createRow) return;
    void (async () => {
      const loadedRows = await Promise.all(rowIds.map(async (rowId) => createRow(rowId)));
      setRows(loadedRows);
    })();
  }, [createRow, rowIds]);
  useEffect(() => handleUpdateRowIds(), [handleUpdateRowIds]);

  return rows.length;
};
