import { DIAGNOSTIC_CATEGORY_BUCKETS } from "@react-doctor/core";
import type { DiagnosticRow } from "./diagnostic-rows.js";

export interface DiagnosticHeaderEntry {
  readonly kind: "header";
  readonly category: string;
}

export interface DiagnosticItemEntry {
  readonly kind: "item";
  readonly row: DiagnosticRow;
  readonly rowIndex: number;
}

export type DiagnosticListEntry = DiagnosticHeaderEntry | DiagnosticItemEntry;

interface IndexedDiagnosticRow {
  readonly row: DiagnosticRow;
  readonly rowIndex: number;
}

const CATEGORY_RANK = new Map<string, number>(
  DIAGNOSTIC_CATEGORY_BUCKETS.map((category, index) => [category, index]),
);

export const buildDiagnosticListEntries = (
  rows: ReadonlyArray<DiagnosticRow>,
): DiagnosticListEntry[] => {
  const rowsByCategory = new Map<string, IndexedDiagnosticRow[]>();
  for (const [rowIndex, row] of rows.entries()) {
    const categoryRows = rowsByCategory.get(row.category) ?? [];
    categoryRows.push({ row, rowIndex });
    rowsByCategory.set(row.category, categoryRows);
  }

  const orderedCategories = [...rowsByCategory.keys()].sort((categoryA, categoryB) => {
    const categoryARank = CATEGORY_RANK.get(categoryA) ?? Number.MAX_SAFE_INTEGER;
    const categoryBRank = CATEGORY_RANK.get(categoryB) ?? Number.MAX_SAFE_INTEGER;
    const rankDelta = categoryARank - categoryBRank;
    return rankDelta !== 0 ? rankDelta : categoryA.localeCompare(categoryB);
  });

  const entries: DiagnosticListEntry[] = [];
  for (const category of orderedCategories) {
    const categoryRows = rowsByCategory.get(category) ?? [];
    entries.push({ kind: "header", category });
    for (const indexedRow of categoryRows) {
      entries.push({ kind: "item", ...indexedRow });
    }
  }
  return entries;
};
