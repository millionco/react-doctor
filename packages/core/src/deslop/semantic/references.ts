import ts from "typescript";
import { MAX_AST_WALK_DEPTH, MAX_TYPE_CONTEXT_PARENT_WALK } from "../constants.js";

export interface SymbolReferenceSite {
  sourceFile: ts.SourceFile;
  identifier: ts.Identifier;
  isDeclarationName: boolean;
  isExportSpecifier: boolean;
  isImportSpecifier: boolean;
  isTypeContext: boolean;
}

export interface ReferenceIndex {
  getReferences: (symbol: ts.Symbol) => SymbolReferenceSite[];
  size: number;
}

const canonicalKeyForSymbol = (symbol: ts.Symbol): ts.Symbol | ts.Node => {
  const firstDeclaration = symbol.declarations?.[0];
  return firstDeclaration ?? symbol;
};

const isDeclarationNameIdentifier = (identifier: ts.Identifier): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (
    (ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isVariableDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return true;
  }
  if (ts.isEnumMember(parent) && parent.name === identifier) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === identifier) return true;
  if (ts.isMethodDeclaration(parent) && parent.name === identifier) return true;
  if (ts.isParameter(parent) && parent.name === identifier) return true;
  if (ts.isBindingElement(parent) && parent.name === identifier) return true;
  return false;
};

const isExportSpecifierIdentifier = (identifier: ts.Identifier): boolean => {
  const parent = identifier.parent;
  return Boolean(parent && ts.isExportSpecifier(parent));
};

const isImportSpecifierIdentifier = (identifier: ts.Identifier): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  return ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
};

const isInTypeContext = (identifier: ts.Identifier): boolean => {
  let current: ts.Node | undefined = identifier.parent;
  let depth = 0;
  while (current && depth < MAX_TYPE_CONTEXT_PARENT_WALK) {
    if (
      ts.isTypeReferenceNode(current) ||
      ts.isTypeQueryNode(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isHeritageClause(current) ||
      ts.isImportTypeNode(current) ||
      ts.isTypePredicateNode(current) ||
      ts.isTypeOperatorNode(current) ||
      ts.isTypeLiteralNode(current) ||
      ts.isIndexedAccessTypeNode(current) ||
      ts.isMappedTypeNode(current) ||
      ts.isConditionalTypeNode(current) ||
      ts.isInferTypeNode(current)
    ) {
      return true;
    }
    if (ts.isExpressionStatement(current) || ts.isBlock(current)) return false;
    current = current.parent;
    depth++;
  }
  return false;
};

const resolveSymbolForIdentifier = (
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.Symbol | undefined => {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(identifier);
  } catch {
    return undefined;
  }
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
};

interface NodeWithJsDoc extends ts.Node {
  jsDoc?: ts.JSDoc[];
}

const visitJsDocNodes = (node: ts.Node, visit: (jsDocNode: ts.Node) => void): void => {
  const jsDocContainer = node as NodeWithJsDoc;
  if (!jsDocContainer.jsDoc) return;
  for (const jsDocNode of jsDocContainer.jsDoc) {
    visit(jsDocNode);
  }
};

export const buildReferenceIndex = (
  program: ts.Program,
  checker: ts.TypeChecker,
): ReferenceIndex => {
  const keyedToReferences = new Map<ts.Symbol | ts.Node, SymbolReferenceSite[]>();

  const recordIdentifier = (identifier: ts.Identifier, sourceFile: ts.SourceFile): void => {
    const resolvedSymbol = resolveSymbolForIdentifier(identifier, checker);
    if (!resolvedSymbol) return;
    const key = canonicalKeyForSymbol(resolvedSymbol);
    const site: SymbolReferenceSite = {
      sourceFile,
      identifier,
      isDeclarationName: isDeclarationNameIdentifier(identifier),
      isExportSpecifier: isExportSpecifierIdentifier(identifier),
      isImportSpecifier: isImportSpecifierIdentifier(identifier),
      isTypeContext: isInTypeContext(identifier),
    };
    const existing = keyedToReferences.get(key);
    if (existing) {
      existing.push(site);
    } else {
      keyedToReferences.set(key, [site]);
    }
  };

  const visitNode = (node: ts.Node, sourceFile: ts.SourceFile, recursionDepth: number): void => {
    if (recursionDepth > MAX_AST_WALK_DEPTH) return;
    if (ts.isIdentifier(node)) {
      recordIdentifier(node, sourceFile);
    }
    visitJsDocNodes(node, (jsDocNode) => visitNode(jsDocNode, sourceFile, recursionDepth + 1));
    node.forEachChild((child) => visitNode(child, sourceFile, recursionDepth + 1));
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    visitNode(sourceFile, sourceFile, 0);
  }

  return {
    getReferences: (symbol) => keyedToReferences.get(canonicalKeyForSymbol(symbol)) ?? [],
    size: keyedToReferences.size,
  };
};
