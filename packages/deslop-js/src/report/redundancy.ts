import type {
  DependencyGraph,
  DuplicateExport,
  DuplicateExportOccurrence,
  RedundantAlias,
} from "../types.js";
import { PLATFORM_SUFFIXES } from "../constants.js";

const isPlatformSpecificModulePath = (modulePath: string): boolean => {
  const extensionIndex = modulePath.lastIndexOf(".");
  if (extensionIndex === -1) return false;
  const withoutExtension = modulePath.slice(0, extensionIndex);
  return PLATFORM_SUFFIXES.some((suffix) => withoutExtension.endsWith(suffix));
};

const platformStrippedBasePath = (modulePath: string): string => {
  const extensionIndex = modulePath.lastIndexOf(".");
  if (extensionIndex === -1) return modulePath;
  const withoutExtension = modulePath.slice(0, extensionIndex);
  for (const suffix of PLATFORM_SUFFIXES) {
    if (withoutExtension.endsWith(suffix)) {
      return withoutExtension.slice(0, -suffix.length) + modulePath.slice(extensionIndex);
    }
  }
  return modulePath;
};

const buildPlatformSiblingGroupSizes = (graph: DependencyGraph): Map<string, number> => {
  const baseToCount = new Map<string, number>();
  for (const module of graph.modules) {
    const base = platformStrippedBasePath(module.fileId.path);
    baseToCount.set(base, (baseToCount.get(base) ?? 0) + 1);
  }
  return baseToCount;
};

export const detectUselessAliasedReExports = (graph: DependencyGraph): RedundantAlias[] => {
  const findings: RedundantAlias[] = [];

  const moduleConsumerImportedNames = new Map<number, Set<string>>();
  const moduleConsumedWholesale = new Set<number>();
  const platformSiblingGroupSizes = buildPlatformSiblingGroupSizes(graph);

  for (const edge of graph.edges) {
    if (edge.isReExportEdge) {
      const reExportedSet = moduleConsumerImportedNames.get(edge.target);
      if (edge.reExportedNames.includes("*")) {
        moduleConsumedWholesale.add(edge.target);
      }
      if (reExportedSet) {
        for (const reExportedName of edge.reExportedNames) reExportedSet.add(reExportedName);
      } else {
        moduleConsumerImportedNames.set(edge.target, new Set(edge.reExportedNames));
      }
      continue;
    }
    if (edge.importedSymbols.length === 0) {
      moduleConsumedWholesale.add(edge.target);
      continue;
    }
    const importedSet = moduleConsumerImportedNames.get(edge.target);
    for (const symbol of edge.importedSymbols) {
      if (symbol.isNamespace || symbol.importedName === "*") {
        moduleConsumedWholesale.add(edge.target);
        continue;
      }
      const importedName = symbol.isDefault ? "default" : symbol.importedName;
      if (importedSet) importedSet.add(importedName);
      else moduleConsumerImportedNames.set(edge.target, new Set([importedName]));
    }
  }

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (moduleConsumedWholesale.has(module.fileId.index)) continue;
    if (isPlatformSpecificModulePath(module.fileId.path)) continue;
    const platformBase = platformStrippedBasePath(module.fileId.path);
    if ((platformSiblingGroupSizes.get(platformBase) ?? 0) > 1) continue;

    const consumerImportedNames = moduleConsumerImportedNames.get(module.fileId.index) ?? new Set();

    for (const exportInfo of module.exports) {
      if (exportInfo.isSynthetic) continue;
      if (!exportInfo.isReExport) continue;
      if (!exportInfo.reExportOriginalName) continue;
      const exportedName = exportInfo.name;
      const originalName = exportInfo.reExportOriginalName;
      if (exportedName === originalName) continue;
      if (exportedName === "*") continue;
      if (originalName === "*") continue;
      if (originalName === "default") continue;
      if (exportInfo.isNamespaceReExport) continue;
      if (consumerImportedNames.has(exportedName)) continue;

      findings.push({
        path: module.fileId.path,
        kind: "reexport-aliased-not-used",
        name: exportedName,
        aliasedFrom: originalName,
        line: exportInfo.line,
        column: exportInfo.column,
        confidence: "medium",
        reason: `\`export { ${originalName} as ${exportedName} } from ...\` renames the symbol but no consumer imports it as \`${exportedName}\` — either drop the alias or have consumers use the new name`,
      });
    }
  }

  return findings;
};

export const detectRedundantAliases = (graph: DependencyGraph): RedundantAlias[] => {
  const findings: RedundantAlias[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (!module.isReachable) continue;

    for (const importInfo of module.imports) {
      for (const binding of importInfo.importedNames) {
        if (!binding.isRedundantAlias) continue;
        findings.push({
          path: module.fileId.path,
          kind: "import-self-alias",
          name: binding.name,
          aliasedFrom: binding.name,
          line: importInfo.line,
          column: importInfo.column,
          confidence: "high",
          reason: `\`import { ${binding.name} as ${binding.name} }\` aliases an identifier to its own name`,
        });
      }
    }

    for (const exportInfo of module.exports) {
      if (exportInfo.isSynthetic) continue;
      if (!exportInfo.isRedundantAlias) continue;
      const kind = exportInfo.isReExport ? "reexport-self-alias" : "export-self-alias";
      const sourceSuffix = exportInfo.reExportSource ? ` from "${exportInfo.reExportSource}"` : "";
      findings.push({
        path: module.fileId.path,
        kind,
        name: exportInfo.name,
        aliasedFrom: exportInfo.name,
        line: exportInfo.line,
        column: exportInfo.column,
        confidence: "high",
        reason: `\`export { ${exportInfo.name} as ${exportInfo.name} }${sourceSuffix}\` aliases an identifier to its own name`,
      });
    }
  }

  return findings;
};

export const detectDuplicateExports = (graph: DependencyGraph): DuplicateExport[] => {
  const findings: DuplicateExport[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;

    const nameToOccurrences = new Map<string, DuplicateExportOccurrence[]>();
    const nameHasReExport = new Map<string, boolean>();

    for (const exportInfo of module.exports) {
      if (exportInfo.isSynthetic) continue;
      if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;

      const occurrence: DuplicateExportOccurrence = {
        line: exportInfo.line,
        column: exportInfo.column,
        reExportSource: exportInfo.reExportSource,
        isReExport: exportInfo.isReExport,
      };
      const existing = nameToOccurrences.get(exportInfo.name);
      if (existing) {
        existing.push(occurrence);
      } else {
        nameToOccurrences.set(exportInfo.name, [occurrence]);
      }
      if (exportInfo.isReExport) {
        nameHasReExport.set(exportInfo.name, true);
      }
    }

    for (const [name, occurrences] of nameToOccurrences) {
      if (occurrences.length < 2) continue;
      if (!nameHasReExport.get(name)) continue;

      findings.push({
        path: module.fileId.path,
        name,
        occurrences,
        confidence: "high",
        reason: `"${name}" is exported ${occurrences.length} times from the same module`,
      });
    }
  }

  return findings;
};
