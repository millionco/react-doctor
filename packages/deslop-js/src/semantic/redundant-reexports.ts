import ts from "typescript";
import type { DependencyGraph, RedundantAlias } from "../types.js";
import type { SemanticContext } from "./program.js";
import { buildSourceFileLookup, normalizeSourcePath } from "./utils/source-file-lookup.js";

const safeGetAliasedSymbol = (
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Symbol | undefined => {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return undefined;
  }
};

interface RoundTripChainEntry {
  modulePath: string;
  sourceFile: ts.SourceFile;
  importSpecifier: ts.ImportSpecifier;
  importedName: string;
  localName: string;
}

const collectImportSpecifierRoundTrips = (
  graph: DependencyGraph,
  sourceFileLookup: Map<string, ts.SourceFile>,
): RoundTripChainEntry[] => {
  const entries: RoundTripChainEntry[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    const sourceFile = sourceFileLookup.get(normalizeSourcePath(module.fileId.path));
    if (!sourceFile) continue;

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const importClause = statement.importClause;
      if (!importClause?.namedBindings) continue;
      if (!ts.isNamedImports(importClause.namedBindings)) continue;
      for (const importSpecifier of importClause.namedBindings.elements) {
        if (!importSpecifier.propertyName) continue;
        const importedName = importSpecifier.propertyName.text;
        const localName = importSpecifier.name.text;
        if (importedName === localName) continue;
        entries.push({
          modulePath: module.fileId.path,
          sourceFile,
          importSpecifier,
          importedName,
          localName,
        });
      }
    }
  }

  return entries;
};

export const detectRoundTripAliases = (
  graph: DependencyGraph,
  context: SemanticContext,
): RedundantAlias[] => {
  const findings: RedundantAlias[] = [];
  const sourceFileLookup = buildSourceFileLookup(context.program);
  const importEntries = collectImportSpecifierRoundTrips(graph, sourceFileLookup);
  if (importEntries.length === 0) return findings;

  const { checker } = context;

  for (const entry of importEntries) {
    const localBindingSymbol = checker.getSymbolAtLocation(entry.importSpecifier.name);
    if (!localBindingSymbol) continue;
    if (!(localBindingSymbol.flags & ts.SymbolFlags.Alias)) continue;
    const resolvedTargetSymbol = safeGetAliasedSymbol(localBindingSymbol, checker);
    if (!resolvedTargetSymbol) continue;
    const originalDeclarationName = resolvedTargetSymbol.name;
    if (!originalDeclarationName) continue;
    if (originalDeclarationName !== entry.localName) continue;
    if (originalDeclarationName === entry.importedName) continue;

    const { line: zeroIndexedLine, character: zeroIndexedColumn } =
      entry.sourceFile.getLineAndCharacterOfPosition(
        entry.importSpecifier.getStart(entry.sourceFile),
      );

    findings.push({
      path: entry.modulePath,
      kind: "roundtrip-alias",
      name: entry.localName,
      aliasedFrom: entry.importedName,
      line: zeroIndexedLine + 1,
      column: zeroIndexedColumn + 1,
      confidence: "high",
      reason: `\`import { ${entry.importedName} as ${entry.localName} }\` renames back to the original declaration name — the upstream rename can be removed`,
    });
  }

  return findings;
};
