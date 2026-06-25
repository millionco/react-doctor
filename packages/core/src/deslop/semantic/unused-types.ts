import ts from "typescript";
import type {
  DependencyGraph,
  DeslopConfig,
  SourceModule,
  UnusedType,
  UnusedTypeKind,
} from "../types.js";
import type { SemanticContext } from "./program.js";
import type { ReferenceIndex, SymbolReferenceSite } from "./references.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { buildSourceFileLookup, normalizeSourcePath } from "./utils/source-file-lookup.js";

interface TypeExportCandidate {
  module: SourceModule;
  exportName: string;
  line: number;
  column: number;
}

const TYPE_DECLARATION_FLAGS =
  ts.SymbolFlags.Interface |
  ts.SymbolFlags.TypeAlias |
  ts.SymbolFlags.Enum |
  ts.SymbolFlags.ConstEnum |
  ts.SymbolFlags.RegularEnum;

const VALUE_DECLARATION_FLAGS =
  ts.SymbolFlags.Variable |
  ts.SymbolFlags.Function |
  ts.SymbolFlags.Class |
  ts.SymbolFlags.BlockScopedVariable |
  ts.SymbolFlags.FunctionScopedVariable;

const collectTypeExportCandidates = (
  graph: DependencyGraph,
  config: DeslopConfig,
): TypeExportCandidate[] => {
  const candidates: TypeExportCandidate[] = [];
  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    for (const exportInfo of module.exports) {
      if (exportInfo.isSynthetic) continue;
      if (!exportInfo.isTypeOnly) continue;
      if (exportInfo.isReExport) continue;
      if (exportInfo.name === "*") continue;
      candidates.push({
        module,
        exportName: exportInfo.name,
        line: exportInfo.line,
        column: exportInfo.column,
      });
    }
  }
  return candidates;
};

const resolveExportSymbol = (
  sourceFile: ts.SourceFile,
  exportName: string,
  checker: ts.TypeChecker,
): ts.Symbol | undefined => {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return undefined;

  const exportsOfModule = checker.getExportsOfModule(moduleSymbol);
  const matchingExport = exportsOfModule.find((exportSymbol) => exportSymbol.name === exportName);
  if (!matchingExport) return undefined;

  if (matchingExport.flags & ts.SymbolFlags.Alias) {
    try {
      return checker.getAliasedSymbol(matchingExport);
    } catch {
      return matchingExport;
    }
  }
  return matchingExport;
};

const isPureTypeSymbol = (symbol: ts.Symbol): boolean => {
  const hasTypeFlags = (symbol.flags & TYPE_DECLARATION_FLAGS) !== 0;
  const hasValueFlags = (symbol.flags & VALUE_DECLARATION_FLAGS) !== 0;
  return hasTypeFlags && !hasValueFlags;
};

const classifyTypeKind = (symbol: ts.Symbol): UnusedTypeKind | undefined => {
  if (symbol.flags & ts.SymbolFlags.Interface) return "interface";
  if (symbol.flags & ts.SymbolFlags.TypeAlias) return "type-alias";
  if (
    symbol.flags &
    (ts.SymbolFlags.Enum | ts.SymbolFlags.ConstEnum | ts.SymbolFlags.RegularEnum)
  ) {
    return "enum-type";
  }
  return undefined;
};

const isReferenceMeaningful = (site: SymbolReferenceSite): boolean => {
  if (site.isDeclarationName) return false;
  return true;
};

const buildTrace = (
  candidate: TypeExportCandidate,
  meaningfulReferenceCount: number,
  totalReferenceCount: number,
  reExportSiteCount: number,
): string[] => {
  const trace = [
    `${candidate.module.fileId.path}:${candidate.line}:${candidate.column} declares "${candidate.exportName}"`,
    `total identifier references resolved to symbol: ${totalReferenceCount}`,
    `references excluding declaration site: ${meaningfulReferenceCount}`,
    `re-export specifier sites: ${reExportSiteCount}`,
  ];
  return trace.slice(0, SEMANTIC_TRACE_MAX_ENTRIES);
};

export const detectUnusedTypes = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext,
  referenceIndex: ReferenceIndex,
): UnusedType[] => {
  const findings: UnusedType[] = [];
  const candidates = collectTypeExportCandidates(graph, config);
  if (candidates.length === 0) return findings;

  const sourceFileLookup = buildSourceFileLookup(context.program);

  for (const candidate of candidates) {
    const sourceFile = sourceFileLookup.get(normalizeSourcePath(candidate.module.fileId.path));
    if (!sourceFile) continue;

    const exportSymbol = resolveExportSymbol(sourceFile, candidate.exportName, context.checker);
    if (!exportSymbol) continue;
    if (!isPureTypeSymbol(exportSymbol)) continue;

    const kind = classifyTypeKind(exportSymbol);
    if (!kind) continue;

    const allReferences = referenceIndex.getReferences(exportSymbol);
    const reExportSites = allReferences.filter((site) => site.isExportSpecifier);
    const meaningfulReferences = allReferences.filter(isReferenceMeaningful);
    const externalUseSites = meaningfulReferences.filter((site) => !site.isExportSpecifier);

    if (externalUseSites.length > 0) continue;

    const declarations = exportSymbol.declarations ?? [];
    if (declarations.length > 1) {
      const declarationFiles = new Set(
        declarations.map((decl) => normalizeSourcePath(decl.getSourceFile().fileName)),
      );
      if (declarationFiles.size > 1) {
        const mergedHasExternalRef = meaningfulReferences.some((site) => {
          const referenceFileName = normalizeSourcePath(site.sourceFile.fileName);
          return !declarationFiles.has(referenceFileName);
        });
        if (mergedHasExternalRef) continue;
      }
    }

    findings.push({
      path: candidate.module.fileId.path,
      name: candidate.exportName,
      line: candidate.line,
      column: candidate.column,
      kind,
      confidence: reExportSites.length > 0 ? "medium" : "high",
      reason:
        reExportSites.length > 0
          ? `type "${candidate.exportName}" is only re-exported through ${reExportSites.length} barrel(s) and never used`
          : `type "${candidate.exportName}" has no references in the project`,
      trace: buildTrace(
        candidate,
        meaningfulReferences.length,
        allReferences.length,
        reExportSites.length,
      ),
    });
  }

  return findings;
};
