import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type {
  DependencyGraph,
  DependencyDeclaredAs,
  DeslopConfig,
  MisclassifiedDependency,
} from "../types.js";
import { extractPackageName } from "../utils/package-name.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";

interface PackageUsageSummary {
  packageName: string;
  hasValueUse: boolean;
  hasTypeOnlyUse: boolean;
  importSites: string[];
}

interface DeclaredDependencyEntry {
  name: string;
  declaredAs: DependencyDeclaredAs;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const TYPES_PACKAGE_PREFIX = "@types/";

const recordImportSite = (summary: PackageUsageSummary, sitePath: string): void => {
  if (summary.importSites.length >= SEMANTIC_TRACE_MAX_ENTRIES) return;
  if (summary.importSites.includes(sitePath)) return;
  summary.importSites.push(sitePath);
};

const isImportEffectivelyTypeOnly = (
  isTypeOnlyDeclaration: boolean,
  importedBindings: Array<{ isTypeOnly: boolean }>,
): boolean => {
  if (isTypeOnlyDeclaration) return true;
  if (importedBindings.length === 0) return false;
  return importedBindings.every((binding) => binding.isTypeOnly);
};

const collectPackageUsageSummaries = (graph: DependencyGraph): Map<string, PackageUsageSummary> => {
  const summaries = new Map<string, PackageUsageSummary>();

  const upsertSummary = (packageName: string): PackageUsageSummary => {
    const existing = summaries.get(packageName);
    if (existing) return existing;
    const fresh: PackageUsageSummary = {
      packageName,
      hasValueUse: false,
      hasTypeOnlyUse: false,
      importSites: [],
    };
    summaries.set(packageName, fresh);
    return fresh;
  };

  for (const module of graph.modules) {
    for (const importInfo of module.imports) {
      const packageName = extractPackageName(importInfo.specifier);
      if (!packageName) continue;
      const summary = upsertSummary(packageName);
      const sitePath = `${module.fileId.path}:${importInfo.line}`;

      if (importInfo.isSideEffect) {
        summary.hasValueUse = true;
        recordImportSite(summary, sitePath);
        continue;
      }

      if (importInfo.isDynamic) {
        summary.hasValueUse = true;
        recordImportSite(summary, sitePath);
        continue;
      }

      const isTypeOnly = isImportEffectivelyTypeOnly(
        importInfo.isTypeOnly,
        importInfo.importedNames,
      );
      if (isTypeOnly) {
        summary.hasTypeOnlyUse = true;
      } else {
        summary.hasValueUse = true;
      }
      recordImportSite(summary, sitePath);
    }

    for (const exportInfo of module.exports) {
      if (!exportInfo.isReExport || !exportInfo.reExportSource) continue;
      const packageName = extractPackageName(exportInfo.reExportSource);
      if (!packageName) continue;
      const summary = upsertSummary(packageName);
      const sitePath = `${module.fileId.path}:${exportInfo.line}`;

      if (exportInfo.isTypeOnly) {
        summary.hasTypeOnlyUse = true;
      } else {
        summary.hasValueUse = true;
      }
      recordImportSite(summary, sitePath);
    }
  }

  return summaries;
};

const readDeclaredDependencies = (rootDir: string): DeclaredDependencyEntry[] => {
  const packageJsonPath = resolvePath(rootDir, "package.json");
  let packageJson: PackageJsonShape;
  try {
    const contents = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(contents);
  } catch {
    return [];
  }

  const entries: DeclaredDependencyEntry[] = [];
  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    entries.push({ name, declaredAs: "dependencies" });
  }
  return entries;
};

export const detectMisclassifiedDependencies = (
  graph: DependencyGraph,
  config: DeslopConfig,
): MisclassifiedDependency[] => {
  const declaredEntries = readDeclaredDependencies(config.rootDir);
  if (declaredEntries.length === 0) return [];

  const packageUsage = collectPackageUsageSummaries(graph);
  const findings: MisclassifiedDependency[] = [];

  for (const declaredEntry of declaredEntries) {
    const usage = packageUsage.get(declaredEntry.name);
    if (!usage) continue;
    if (usage.hasValueUse) continue;
    if (!usage.hasTypeOnlyUse) continue;

    const isTypesPackage = declaredEntry.name.startsWith(TYPES_PACKAGE_PREFIX);

    findings.push({
      name: declaredEntry.name,
      declaredAs: declaredEntry.declaredAs,
      suggestedAs: "devDependencies",
      confidence: isTypesPackage ? "high" : "medium",
      reason: isTypesPackage
        ? `"${declaredEntry.name}" is a @types/* package in dependencies but is only consumed via type imports — should be in devDependencies`
        : `"${declaredEntry.name}" is in dependencies but only consumed via \`import type\` / \`export type\` — consider devDependencies (or keep here if downstream consumers need its types)`,
      trace: usage.importSites,
    });
  }

  return findings;
};
