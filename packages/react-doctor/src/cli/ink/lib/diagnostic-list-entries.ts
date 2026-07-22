import { DIAGNOSTIC_CATEGORY_BUCKETS } from "@react-doctor/core";
import type { DiagnosticRow } from "./diagnostic-rows.js";

export interface DiagnosticHeaderEntry {
  readonly kind: "header";
  readonly category: string;
}

export interface DiagnosticItemEntry {
  readonly kind: "item";
  readonly row: DiagnosticRow;
}

export type DiagnosticListEntry = DiagnosticHeaderEntry | DiagnosticItemEntry;

const CATEGORY_RANK = new Map<string, number>(
  DIAGNOSTIC_CATEGORY_BUCKETS.map((category, index) => [category, index]),
);

const rankOf = (category: string): number => CATEGORY_RANK.get(category) ?? Number.MAX_SAFE_INTEGER;

export const buildDiagnosticListEntries = (
  rows: ReadonlyArray<DiagnosticRow>,
): DiagnosticListEntry[] => {
  const rowsByCategory = new Map<string, DiagnosticRow[]>();
  for (const row of rows) {
    const categoryRows = rowsByCategory.get(row.category) ?? [];
    categoryRows.push(row);
    rowsByCategory.set(row.category, categoryRows);
  }

  const orderedCategories = [...rowsByCategory.keys()].sort((categoryA, categoryB) => {
    const rankDelta = rankOf(categoryA) - rankOf(categoryB);
    return rankDelta !== 0 ? rankDelta : categoryA.localeCompare(categoryB);
  });

  const entries: DiagnosticListEntry[] = [];
  for (const category of orderedCategories) {
    const categoryRows = rowsByCategory.get(category) ?? [];
    entries.push({ kind: "header", category });
    for (const row of categoryRows) entries.push({ kind: "item", row });
  }
  return entries;
};
