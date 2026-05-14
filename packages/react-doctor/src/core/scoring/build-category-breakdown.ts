import type { Diagnostic } from "../../types/diagnostic.js";

interface CategoryBreakdownEntry {
  category: string;
  totalCount: number;
  errorCount: number;
  warningCount: number;
}

export const buildCategoryBreakdown = (diagnostics: Diagnostic[]): CategoryBreakdownEntry[] => {
  const entriesByCategory = new Map<string, CategoryBreakdownEntry>();
  for (const diagnostic of diagnostics) {
    const existingEntry = entriesByCategory.get(diagnostic.category) ?? {
      category: diagnostic.category,
      totalCount: 0,
      errorCount: 0,
      warningCount: 0,
    };
    existingEntry.totalCount += 1;
    if (diagnostic.severity === "error") {
      existingEntry.errorCount += 1;
    } else {
      existingEntry.warningCount += 1;
    }
    entriesByCategory.set(diagnostic.category, existingEntry);
  }
  return [...entriesByCategory.values()].sort((entryA, entryB) => {
    if (entryA.errorCount !== entryB.errorCount) return entryB.errorCount - entryA.errorCount;
    if (entryA.totalCount !== entryB.totalCount) return entryB.totalCount - entryA.totalCount;
    return entryA.category.localeCompare(entryB.category);
  });
};
