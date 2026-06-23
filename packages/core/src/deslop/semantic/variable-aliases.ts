import ts from "typescript";
import type { DependencyGraph, RedundantAlias } from "../types.js";
import type { SemanticContext } from "./program.js";
import type { ReferenceIndex, SymbolReferenceSite } from "./references.js";
import { buildSourceFileLookup, normalizeSourcePath } from "./utils/source-file-lookup.js";

interface CandidateVariableAlias {
  sourceFile: ts.SourceFile;
  declaration: ts.VariableDeclaration;
  aliasName: string;
  aliasedFromName: string;
  modulePath: string;
}

const isSimpleIdentifierInitializer = (
  initializer: ts.Expression | undefined,
): initializer is ts.Identifier => Boolean(initializer && ts.isIdentifier(initializer));

const isModuleLevelDeclaration = (declaration: ts.VariableDeclaration): boolean => {
  const variableDeclarationList = declaration.parent;
  if (!variableDeclarationList || !ts.isVariableDeclarationList(variableDeclarationList)) {
    return false;
  }
  const statement = variableDeclarationList.parent;
  return Boolean(statement && ts.isSourceFile(statement.parent));
};

const isDeclarationExported = (declaration: ts.VariableDeclaration): boolean => {
  const variableDeclarationList = declaration.parent;
  if (!variableDeclarationList || !ts.isVariableDeclarationList(variableDeclarationList)) {
    return false;
  }
  const statement = variableDeclarationList.parent;
  if (!statement || !ts.isVariableStatement(statement)) return false;
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  if (!modifiers) return false;
  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
};

const collectVariableAliasCandidates = (
  graph: DependencyGraph,
  sourceFileLookup: Map<string, ts.SourceFile>,
): CandidateVariableAlias[] => {
  const candidates: CandidateVariableAlias[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;

    const sourceFile = sourceFileLookup.get(normalizeSourcePath(module.fileId.path));
    if (!sourceFile) continue;

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (!isSimpleIdentifierInitializer(declaration.initializer)) continue;
        if (!isModuleLevelDeclaration(declaration)) continue;

        const aliasName = declaration.name.text;
        const aliasedFromName = declaration.initializer.text;
        if (aliasName === aliasedFromName) continue;

        candidates.push({
          sourceFile,
          declaration,
          aliasName,
          aliasedFromName,
          modulePath: module.fileId.path,
        });
      }
    }
  }

  return candidates;
};

const isMeaningfulReference = (site: SymbolReferenceSite): boolean => {
  if (site.isDeclarationName) return false;
  if (site.isImportSpecifier) return false;
  if (site.isExportSpecifier) return false;
  return true;
};

const resolveThroughAliasChain = (symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol => {
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
};

export const detectRedundantVariableAliases = (
  graph: DependencyGraph,
  context: SemanticContext,
  referenceIndex: ReferenceIndex,
): RedundantAlias[] => {
  const findings: RedundantAlias[] = [];
  const sourceFileLookup = buildSourceFileLookup(context.program);
  const candidates = collectVariableAliasCandidates(graph, sourceFileLookup);
  if (candidates.length === 0) return findings;

  const { checker } = context;

  for (const candidate of candidates) {
    if (isDeclarationExported(candidate.declaration)) continue;

    const aliasNameIdentifier = candidate.declaration.name;
    if (!ts.isIdentifier(aliasNameIdentifier)) continue;
    if (!candidate.declaration.initializer || !ts.isIdentifier(candidate.declaration.initializer)) {
      continue;
    }

    const rawAliasSymbol = checker.getSymbolAtLocation(aliasNameIdentifier);
    const rawSourceSymbol = checker.getSymbolAtLocation(candidate.declaration.initializer);
    if (!rawAliasSymbol || !rawSourceSymbol) continue;
    const aliasSymbol = resolveThroughAliasChain(rawAliasSymbol, checker);
    const sourceSymbol = resolveThroughAliasChain(rawSourceSymbol, checker);
    if (aliasSymbol === sourceSymbol) continue;

    const sourceMeaningfulRefs = referenceIndex
      .getReferences(sourceSymbol)
      .filter(isMeaningfulReference);
    const aliasMeaningfulRefs = referenceIndex
      .getReferences(aliasSymbol)
      .filter(isMeaningfulReference);

    const sourceReferenceSitesOutsideAliasInit = sourceMeaningfulRefs.filter(
      (site) => site.identifier !== candidate.declaration.initializer,
    );
    if (sourceReferenceSitesOutsideAliasInit.length > 0) continue;
    if (aliasMeaningfulRefs.length === 0) continue;

    const { line: zeroIndexedLine, character: zeroIndexedColumn } =
      candidate.sourceFile.getLineAndCharacterOfPosition(
        candidate.declaration.getStart(candidate.sourceFile),
      );

    findings.push({
      path: candidate.modulePath,
      kind: "variable-alias",
      name: candidate.aliasName,
      aliasedFrom: candidate.aliasedFromName,
      line: zeroIndexedLine + 1,
      column: zeroIndexedColumn + 1,
      confidence: "high",
      reason: `\`const ${candidate.aliasName} = ${candidate.aliasedFromName}\` is the only consumer of \`${candidate.aliasedFromName}\` — rename or inline`,
    });
  }

  return findings;
};
