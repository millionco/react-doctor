import * as ts from "typescript";

interface ReactImportBindings {
  namespaceNames: Set<string>;
  useImportNames: Set<string>;
}

export interface BindingResolution {
  isReactUseBinding: boolean;
}

const REACT_MODULE_SOURCE = "react";
const USE_IDENTIFIER = "use";

const getScriptKind = (filename: string): ts.ScriptKind => {
  if (filename.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filename.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filename.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};

const getUtf16Offset = (sourceText: string, utf8Offset: number): number =>
  Buffer.from(sourceText).subarray(0, utf8Offset).toString("utf8").length;

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let currentExpression = expression;
  while (
    ts.isParenthesizedExpression(currentExpression) ||
    ts.isAsExpression(currentExpression) ||
    ts.isSatisfiesExpression(currentExpression) ||
    ts.isNonNullExpression(currentExpression) ||
    ts.isTypeAssertionExpression(currentExpression)
  ) {
    currentExpression = currentExpression.expression;
  }
  return currentExpression;
};

const getStaticPropertyName = (node: ts.PropertyName | undefined): string | null => {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))
    return node.text;
  if (ts.isComputedPropertyName(node)) {
    const expression = unwrapExpression(node.expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
  }
  return null;
};

const findUseBindingIdentifier = (bindingName: ts.BindingName): ts.Identifier | null => {
  if (ts.isIdentifier(bindingName)) return bindingName.text === USE_IDENTIFIER ? bindingName : null;

  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const nestedIdentifier = findUseBindingIdentifier(element.name);
    if (nestedIdentifier) return nestedIdentifier;
  }

  return null;
};

const isReactRequireCall = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapExpression(expression);
  return (
    ts.isCallExpression(unwrappedExpression) &&
    ts.isIdentifier(unwrappedExpression.expression) &&
    unwrappedExpression.expression.text === "require" &&
    unwrappedExpression.arguments.length === 1 &&
    ts.isStringLiteral(unwrappedExpression.arguments[0]) &&
    unwrappedExpression.arguments[0].text === REACT_MODULE_SOURCE
  );
};

const getModuleSource = (node: ts.Node): string | null => {
  let currentNode: ts.Node | undefined = node;
  while (currentNode) {
    if (ts.isImportDeclaration(currentNode) && ts.isStringLiteral(currentNode.moduleSpecifier)) {
      return currentNode.moduleSpecifier.text;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const getImportedName = (importSpecifier: ts.ImportSpecifier): string =>
  importSpecifier.propertyName?.text ?? importSpecifier.name.text;

const collectReactObjectBindingNames = (
  bindingPattern: ts.ObjectBindingPattern,
  useImportNames: Set<string>,
): void => {
  for (const bindingElement of bindingPattern.elements) {
    const propertyName = getStaticPropertyName(bindingElement.propertyName);
    if (bindingElement.propertyName && propertyName !== null && propertyName !== USE_IDENTIFIER) {
      continue;
    }
    const bindingIdentifier = findUseBindingIdentifier(bindingElement.name);
    if (bindingIdentifier) useImportNames.add(bindingIdentifier.text);
  }
};

const collectReactImportBindings = (sourceFile: ts.SourceFile): ReactImportBindings => {
  const namespaceNames = new Set<string>();
  const useImportNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (statement.moduleSpecifier.text !== REACT_MODULE_SOURCE) continue;

      const importClause = statement.importClause;
      if (!importClause) continue;
      if (importClause.name) namespaceNames.add(importClause.name.text);

      const namedBindings = importClause.namedBindings;
      if (!namedBindings) continue;
      if (ts.isNamespaceImport(namedBindings)) {
        namespaceNames.add(namedBindings.name.text);
        continue;
      }

      for (const importSpecifier of namedBindings.elements) {
        if (getImportedName(importSpecifier) === USE_IDENTIFIER) {
          useImportNames.add(importSpecifier.name.text);
        }
      }
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      if (!isReactRequireCall(declaration.initializer)) continue;
      if (ts.isIdentifier(declaration.name)) {
        namespaceNames.add(declaration.name.text);
        continue;
      }
      if (ts.isObjectBindingPattern(declaration.name)) {
        collectReactObjectBindingNames(declaration.name, useImportNames);
      }
    }
  }

  return { namespaceNames, useImportNames };
};

const isReactNamespaceExpression = (
  expression: ts.Expression,
  reactImportBindings: ReactImportBindings,
): boolean => {
  const unwrappedExpression = unwrapExpression(expression);
  return (
    isReactRequireCall(unwrappedExpression) ||
    (ts.isIdentifier(unwrappedExpression) &&
      reactImportBindings.namespaceNames.has(unwrappedExpression.text))
  );
};

const isReactUseExpression = (
  expression: ts.Expression | undefined,
  reactImportBindings: ReactImportBindings,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) {
    return reactImportBindings.useImportNames.has(unwrappedExpression.text);
  }
  if (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === USE_IDENTIFIER &&
    isReactNamespaceExpression(unwrappedExpression.expression, reactImportBindings)
  ) {
    return true;
  }
  if (
    ts.isElementAccessExpression(unwrappedExpression) &&
    ts.isStringLiteral(unwrappedExpression.argumentExpression) &&
    unwrappedExpression.argumentExpression.text === USE_IDENTIFIER
  ) {
    return isReactNamespaceExpression(unwrappedExpression.expression, reactImportBindings);
  }
  return false;
};

const findBindingElement = (identifier: ts.Identifier): ts.BindingElement | null => {
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode) {
    if (ts.isBindingElement(currentNode)) return currentNode;
    if (ts.isVariableDeclaration(currentNode) || ts.isParameter(currentNode)) return null;
    currentNode = currentNode.parent;
  }
  return null;
};

const isReactUseObjectBinding = (
  identifier: ts.Identifier,
  variableDeclaration: ts.VariableDeclaration,
  reactImportBindings: ReactImportBindings,
): boolean => {
  const bindingElement = findBindingElement(identifier);
  if (!bindingElement) return false;
  if (!ts.isObjectBindingPattern(bindingElement.parent)) return false;
  if (!variableDeclaration.initializer) return false;
  if (!isReactNamespaceExpression(variableDeclaration.initializer, reactImportBindings)) {
    return false;
  }
  if (!bindingElement.propertyName) return true;
  const propertyName = getStaticPropertyName(bindingElement.propertyName);
  return propertyName === null || propertyName === USE_IDENTIFIER;
};

const getVariableDeclarationResolution = (
  variableDeclaration: ts.VariableDeclaration,
  reactImportBindings: ReactImportBindings,
): BindingResolution | null => {
  const bindingIdentifier = findUseBindingIdentifier(variableDeclaration.name);
  if (!bindingIdentifier) return null;
  return {
    isReactUseBinding:
      isReactUseExpression(variableDeclaration.initializer, reactImportBindings) ||
      isReactUseObjectBinding(bindingIdentifier, variableDeclaration, reactImportBindings),
  };
};

const getImportResolution = (node: ts.Node): BindingResolution | null => {
  if (ts.isImportSpecifier(node) && node.name.text === USE_IDENTIFIER) {
    return {
      isReactUseBinding:
        getModuleSource(node) === REACT_MODULE_SOURCE && getImportedName(node) === USE_IDENTIFIER,
    };
  }
  if (ts.isNamespaceImport(node) && node.name.text === USE_IDENTIFIER) {
    return { isReactUseBinding: false };
  }
  if (ts.isImportClause(node) && node.name?.text === USE_IDENTIFIER) {
    return { isReactUseBinding: false };
  }
  return null;
};

const getDeclarationResolution = (
  node: ts.Node,
  reactImportBindings: ReactImportBindings,
): BindingResolution | null => {
  const importResolution = getImportResolution(node);
  if (importResolution) return importResolution;

  if (ts.isVariableDeclaration(node)) {
    return getVariableDeclarationResolution(node, reactImportBindings);
  }
  if (ts.isParameter(node)) {
    return findUseBindingIdentifier(node.name) ? { isReactUseBinding: false } : null;
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === USE_IDENTIFIER) {
    return { isReactUseBinding: false };
  }
  if (ts.isClassDeclaration(node) && node.name?.text === USE_IDENTIFIER) {
    return { isReactUseBinding: false };
  }
  return null;
};

const isNestedScopeBoundary = (node: ts.Node, scopeNode: ts.Node): boolean =>
  node !== scopeNode &&
  (ts.isFunctionLike(node) ||
    ts.isClassLike(node) ||
    ts.isBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCatchClause(node) ||
    ts.isSourceFile(node) ||
    ts.isModuleBlock(node));

const findResolutionInSubtree = (
  node: ts.Node,
  scopeNode: ts.Node,
  useOffset: number,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
): BindingResolution | null => {
  const nodeStart = node.getStart(sourceFile);
  if (nodeStart > useOffset) return null;

  const declarationResolution = getDeclarationResolution(node, reactImportBindings);
  if (declarationResolution) return declarationResolution;
  if (isNestedScopeBoundary(node, scopeNode)) return null;

  let resolution: BindingResolution | null = null;
  ts.forEachChild(node, (child) => {
    if (resolution) return;
    resolution = findResolutionInSubtree(
      child,
      scopeNode,
      useOffset,
      reactImportBindings,
      sourceFile,
    );
  });
  return resolution;
};

const findResolutionInFunctionParameters = (
  node: ts.Node,
  reactImportBindings: ReactImportBindings,
): BindingResolution | null => {
  if (!ts.isFunctionLike(node)) return null;
  for (const parameter of node.parameters) {
    const parameterResolution = getDeclarationResolution(parameter, reactImportBindings);
    if (parameterResolution) return parameterResolution;
  }
  return null;
};

const findResolutionInScope = (
  scopeNode: ts.Node,
  useOffset: number,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
): BindingResolution | null => {
  const parameterResolution = findResolutionInFunctionParameters(scopeNode, reactImportBindings);
  if (parameterResolution) return parameterResolution;

  let resolution: BindingResolution | null = null;
  ts.forEachChild(scopeNode, (child) => {
    if (resolution) return;
    resolution = findResolutionInSubtree(
      child,
      scopeNode,
      useOffset,
      reactImportBindings,
      sourceFile,
    );
  });
  return resolution;
};

const isScopeNode = (node: ts.Node): boolean =>
  ts.isSourceFile(node) ||
  ts.isBlock(node) ||
  ts.isModuleBlock(node) ||
  ts.isFunctionLike(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isCatchClause(node);

const resolveUseBinding = (
  useIdentifier: ts.Identifier,
  useOffset: number,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
): BindingResolution | null => {
  let currentNode: ts.Node | undefined = useIdentifier.parent;
  while (currentNode) {
    if (isScopeNode(currentNode)) {
      const resolution = findResolutionInScope(
        currentNode,
        useOffset,
        reactImportBindings,
        sourceFile,
      );
      if (resolution) return resolution;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const isUseCallIdentifier = (node: ts.Identifier): boolean =>
  node.text === USE_IDENTIFIER &&
  ts.isCallExpression(node.parent) &&
  node.parent.expression === node;

const findUseCallIdentifier = (
  sourceFile: ts.SourceFile,
  useOffset: number,
): ts.Identifier | null => {
  let matchedIdentifier: ts.Identifier | null = null;

  const visit = (node: ts.Node): void => {
    if (matchedIdentifier) return;
    if (
      ts.isIdentifier(node) &&
      isUseCallIdentifier(node) &&
      node.getStart(sourceFile) === useOffset
    ) {
      matchedIdentifier = node;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return matchedIdentifier;
};

export const resolveUseCallBinding = (
  sourceText: string,
  filename: string,
  utf8Offset: number,
): BindingResolution | null => {
  const sourceFile = ts.createSourceFile(
    filename,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filename),
  );
  const useOffset = getUtf16Offset(sourceText, utf8Offset);
  const useIdentifier = findUseCallIdentifier(sourceFile, useOffset);
  if (!useIdentifier) return null;
  return resolveUseBinding(
    useIdentifier,
    useOffset,
    collectReactImportBindings(sourceFile),
    sourceFile,
  );
};
