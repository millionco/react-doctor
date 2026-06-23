import type {
  CrossFileDuplicateExport,
  CrossFileDuplicateExportLocation,
  DependencyGraph,
} from "../types.js";

interface ExportEntry {
  moduleIndex: number;
  path: string;
  line: number;
  column: number;
  isTypeOnly: boolean;
}

const buildReExportSourceSets = (graph: DependencyGraph): Map<number, Set<number>> => {
  const reExportSources = new Map<number, Set<number>>();
  for (const edge of graph.edges) {
    if (!edge.isReExportEdge) continue;
    const existing = reExportSources.get(edge.source);
    if (existing) {
      existing.add(edge.target);
    } else {
      reExportSources.set(edge.source, new Set([edge.target]));
    }
  }
  return reExportSources;
};

/**
 * Two duplicate-export files "share a common importer" when there exists a
 * third file that imports from both, OR one duplicate file imports another.
 * This filters out coincidental duplicates among unrelated leaf modules
 * (SvelteKit/Next.js route files, scripts in different parts of a monorepo,
 * etc.) that happen to export the same name but can never be confused at any
 * import site.
 */
const hasCommonImporter = (moduleIndices: number[], graph: DependencyGraph): boolean => {
  if (moduleIndices.length <= 1) return false;
  const duplicateModuleSet = new Set(moduleIndices);

  const importerOwner = new Map<number, number>();
  for (const moduleIndex of moduleIndices) {
    const importers = graph.reverseEdges.get(moduleIndex) ?? [];
    for (const importerIndex of importers) {
      if (duplicateModuleSet.has(importerIndex)) return true;
      const previousOwner = importerOwner.get(importerIndex);
      if (previousOwner === undefined) {
        importerOwner.set(importerIndex, moduleIndex);
      } else if (previousOwner !== moduleIndex) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Cross-file duplicate exports: the same exported name lives in 2+ files.
 *
 * Filters applied (to keep the rule actionable):
 * - default exports are skipped (every module gets one and it's not actionable)
 * - re-export chains are pruned: if module A re-exports `Foo` from module B,
 *   the (A, B) pair is one chain, not two real declarations
 * - TypeScript value/type namespace split: `export const X` and `export type X`
 *   in the same file are distinct in TS's value/type namespaces; same name in a
 *   value file and a type file is not a true duplicate either
 * - common-importer filter: only report duplicates where two of the duplicate
 *   files share an importer or one imports another, so unrelated route files in
 *   different parts of a repo don't get flagged
 */
export const detectCrossFileDuplicateExports = (
  graph: DependencyGraph,
): CrossFileDuplicateExport[] => {
  const reExportSources = buildReExportSourceSets(graph);
  const exportEntriesByName = new Map<string, ExportEntry[]>();

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint) continue;

    for (const exportInfo of module.exports) {
      if (exportInfo.isDefault) continue;
      if (exportInfo.isSynthetic) continue;
      if (exportInfo.name === "*") continue;
      if (exportInfo.isReExport) continue;

      const entry: ExportEntry = {
        moduleIndex: module.fileId.index,
        path: module.fileId.path,
        line: exportInfo.line,
        column: exportInfo.column,
        isTypeOnly: exportInfo.isTypeOnly,
      };

      const existing = exportEntriesByName.get(exportInfo.name);
      if (existing) {
        existing.push(entry);
      } else {
        exportEntriesByName.set(exportInfo.name, [entry]);
      }
    }
  }

  const findings: CrossFileDuplicateExport[] = [];
  const sortedEntries = [...exportEntriesByName.entries()].sort(([nameA], [nameB]) =>
    nameA.localeCompare(nameB),
  );

  for (const [name, entries] of sortedEntries) {
    if (entries.length <= 1) continue;

    const hasValueExport = entries.some((entry) => !entry.isTypeOnly);
    const hasTypeExport = entries.some((entry) => entry.isTypeOnly);
    if (hasValueExport && hasTypeExport) {
      const valueModuleIndices = new Set(
        entries.filter((entry) => !entry.isTypeOnly).map((entry) => entry.moduleIndex),
      );
      const typeModuleIndices = new Set(
        entries.filter((entry) => entry.isTypeOnly).map((entry) => entry.moduleIndex),
      );
      if (valueModuleIndices.size <= 1 && typeModuleIndices.size <= 1) continue;
    }

    const moduleIndexSet = new Set(entries.map((entry) => entry.moduleIndex));
    const independentEntries = entries.filter((entry) => {
      const sources = reExportSources.get(entry.moduleIndex);
      if (!sources) return true;
      for (const sourceIndex of sources) {
        if (moduleIndexSet.has(sourceIndex)) return false;
      }
      return true;
    });

    if (independentEntries.length <= 1) continue;

    const independentModuleIndices = independentEntries.map((entry) => entry.moduleIndex);
    if (!hasCommonImporter(independentModuleIndices, graph)) continue;

    const locations: CrossFileDuplicateExportLocation[] = independentEntries.map((entry) => ({
      path: entry.path,
      line: entry.line,
      column: entry.column,
      isTypeOnly: entry.isTypeOnly,
    }));

    findings.push({
      name,
      locations,
      confidence: "medium",
      reason: `"${name}" is exported from ${locations.length} files that share a common importer — consumers may import the wrong one`,
    });
  }

  return findings;
};
