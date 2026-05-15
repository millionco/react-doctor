import * as ts from "typescript";

interface ReactImportBindings {
  namespaceNames: Set<string>;
  useImportNames: Set<string>;
}

export interface BindingResolution {
  isReactUseBinding: boolean;
  isReactNamespaceBinding: boolean;
}

const REACT_MODULE_SOURCE = "react";
const REQUIRE_IDENTIFIER = "require";
const USE_IDENTIFIER = "use";

const LOCAL_BINDING_RESOLUTION: BindingResolution = {
  isReactUseBinding: false,
  isReactNamespaceBinding: false,
};

const REACT_NAMESPACE_BINDING_RESOLUTION: BindingResolution = {
  isReactUseBinding: false,
  isReactNamespaceBinding: true,
};

const REACT_USE_BINDING_RESOLUTION: BindingResolution = {
  isReactUseBinding: true,
  isReactNamespaceBinding: false,
};

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

const findBindingIdentifier = (
  bindingName: ts.BindingName,
  identifierName: string,
): ts.Identifier | null => {
  if (ts.isIdentifier(bindingName)) return bindingName.text === identifierName ? bindingName : null;

  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const nestedIdentifier = findBindingIdentifier(element.name, identifierName);
    if (nestedIdentifier) return nestedIdentifier;
  }

  return null;
};

const bindingNameHasIdentifier = (bindingName: ts.BindingName, identifierName: string): boolean => {
  if (ts.isIdentifier(bindingName)) return bindingName.text === identifierName;

  return bindingName.elements.some((element) => {
    if (ts.isOmittedExpression(element)) return false;
    return bindingNameHasIdentifier(element.name, identifierName);
  });
};

const getDirectBindingIdentifier = (bindingName: ts.BindingName): ts.Identifier | null =>
  ts.isIdentifier(bindingName) ? bindingName : null;

const isReactUseObjectBindingElement = (bindingElement: ts.BindingElement): boolean => {
  const bindingIdentifier = getDirectBindingIdentifier(bindingElement.name);
  if (!bindingIdentifier) return false;
  if (!bindingElement.propertyName) return bindingIdentifier.text === USE_IDENTIFIER;
  const propertyName = getStaticPropertyName(bindingElement.propertyName);
  return propertyName === USE_IDENTIFIER;
};

const isReactRequireCall = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapExpression(expression);
  return (
    ts.isCallExpression(unwrappedExpression) &&
    ts.isIdentifier(unwrappedExpression.expression) &&
    unwrappedExpression.expression.text === REQUIRE_IDENTIFIER &&
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
    const bindingIdentifier = getDirectBindingIdentifier(bindingElement.name);
    if (bindingIdentifier && isReactUseObjectBindingElement(bindingElement)) {
      useImportNames.add(bindingIdentifier.text);
    }
  }
};

const isReactObjectBindingName = (
  bindingPattern: ts.ObjectBindingPattern,
  identifierName: string,
): boolean =>
  bindingPattern.elements.some((bindingElement) => {
    const bindingIdentifier = getDirectBindingIdentifier(bindingElement.name);
    if (bindingIdentifier?.text !== identifierName) return false;
    return isReactUseObjectBindingElement(bindingElement);
  });

const isReactRequireBindingDeclaration = (node: ts.Node, identifierName: string): boolean => {
  if (!ts.isVariableDeclaration(node)) return false;
  if (!node.initializer) return false;
  if (!isReactRequireCall(node.initializer)) return false;
  if (ts.isIdentifier(node.name)) return node.name.text === identifierName;
  return (
    ts.isObjectBindingPattern(node.name) && isReactObjectBindingName(node.name, identifierName)
  );
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

const findBindingElement = (identifier: ts.Identifier): ts.BindingElement | null => {
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode) {
    if (ts.isBindingElement(currentNode)) return currentNode;
    if (ts.isVariableDeclaration(currentNode) || ts.isParameter(currentNode)) return null;
    currentNode = currentNode.parent;
  }
  return null;
};

const declarationBindsIdentifier = (node: ts.Node, identifierName: string): boolean => {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
    return bindingNameHasIdentifier(node.name, identifierName);
  }
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    return node.name?.text === identifierName;
  }
  return false;
};

const isScopeBoundary = (node: ts.Node): boolean =>
  ts.isFunctionLike(node) ||
  ts.isClassLike(node) ||
  ts.isBlock(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isCatchClause(node) ||
  ts.isSourceFile(node) ||
  ts.isModuleBlock(node);

const scopeContainsNonImportBinding = (
  node: ts.Node,
  scopeNode: ts.Node,
  identifierName: string,
): boolean => {
  if (isReactRequireBindingDeclaration(node, identifierName)) return false;
  if (declarationBindsIdentifier(node, identifierName)) return true;
  if (node !== scopeNode && isScopeBoundary(node)) return false;

  let didFindBinding = false;
  ts.forEachChild(node, (child) => {
    if (didFindBinding) return;
    didFindBinding = scopeContainsNonImportBinding(child, scopeNode, identifierName);
  });
  return didFindBinding;
};

const isIdentifierShadowedByLocalBinding = (
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): boolean => {
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode) {
    if (isScopeNode(currentNode)) {
      if (scopeContainsNonImportBinding(currentNode, currentNode, identifier.text)) return true;
    }
    if (currentNode === sourceFile) return false;
    currentNode = currentNode.parent;
  }
  return false;
};

const isReactNamespaceExpression = (
  expression: ts.Expression,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): boolean => {
  const unwrappedExpression = unwrapExpression(expression);
  if (isReactRequireCall(unwrappedExpression)) return true;
  if (!ts.isIdentifier(unwrappedExpression)) return false;
  if (
    reactImportBindings.namespaceNames.has(unwrappedExpression.text) &&
    !isIdentifierShadowedByLocalBinding(unwrappedExpression, sourceFile)
  ) {
    return true;
  }
  return (
    resolveIdentifierBinding(
      unwrappedExpression,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    )?.isReactNamespaceBinding ?? false
  );
};

const isReactUseExpression = (
  expression: ts.Expression | undefined,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) {
    if (
      reactImportBindings.useImportNames.has(unwrappedExpression.text) &&
      !isIdentifierShadowedByLocalBinding(unwrappedExpression, sourceFile)
    ) {
      return true;
    }
    if (unwrappedExpression.text === USE_IDENTIFIER) return false;
    return (
      resolveIdentifierBinding(
        unwrappedExpression,
        reactImportBindings,
        sourceFile,
        visitedDeclarations,
      )?.isReactUseBinding ?? false
    );
  }
  if (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === USE_IDENTIFIER &&
    isReactNamespaceExpression(
      unwrappedExpression.expression,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    )
  ) {
    return true;
  }
  if (
    ts.isElementAccessExpression(unwrappedExpression) &&
    ts.isStringLiteral(unwrappedExpression.argumentExpression) &&
    unwrappedExpression.argumentExpression.text === USE_IDENTIFIER
  ) {
    return isReactNamespaceExpression(
      unwrappedExpression.expression,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    );
  }
  return false;
};

const isReactUseObjectBinding = (
  identifier: ts.Identifier,
  variableDeclaration: ts.VariableDeclaration,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): boolean => {
  const bindingElement = findBindingElement(identifier);
  if (!bindingElement) return false;
  if (!ts.isObjectBindingPattern(bindingElement.parent)) return false;
  if (!variableDeclaration.initializer) return false;
  if (
    !isReactNamespaceExpression(
      variableDeclaration.initializer,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    )
  ) {
    return false;
  }
  return isReactUseObjectBindingElement(bindingElement);
};

const getVariableDeclarationResolution = (
  variableDeclaration: ts.VariableDeclaration,
  identifierName: string,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): BindingResolution | null => {
  const bindingIdentifier = findBindingIdentifier(variableDeclaration.name, identifierName);
  if (!bindingIdentifier) return null;
  if (visitedDeclarations.has(variableDeclaration)) return null;
  const nestedVisitedDeclarations = new Set(visitedDeclarations);
  nestedVisitedDeclarations.add(variableDeclaration);
  const isDirectBinding = ts.isIdentifier(variableDeclaration.name);
  const isReactNamespaceBinding =
    isDirectBinding &&
    variableDeclaration.initializer !== undefined &&
    isReactNamespaceExpression(
      variableDeclaration.initializer,
      reactImportBindings,
      sourceFile,
      new Set(nestedVisitedDeclarations),
    );
  return {
    isReactNamespaceBinding,
    isReactUseBinding:
      isReactUseExpression(
        variableDeclaration.initializer,
        reactImportBindings,
        sourceFile,
        new Set(nestedVisitedDeclarations),
      ) ||
      isReactUseObjectBinding(
        bindingIdentifier,
        variableDeclaration,
        reactImportBindings,
        sourceFile,
        new Set(nestedVisitedDeclarations),
      ),
  };
};

const getImportResolution = (node: ts.Node, identifierName: string): BindingResolution | null => {
  if (ts.isImportSpecifier(node) && node.name.text === identifierName) {
    return getModuleSource(node) === REACT_MODULE_SOURCE && getImportedName(node) === USE_IDENTIFIER
      ? REACT_USE_BINDING_RESOLUTION
      : LOCAL_BINDING_RESOLUTION;
  }
  if (ts.isNamespaceImport(node) && node.name.text === identifierName) {
    return getModuleSource(node) === REACT_MODULE_SOURCE
      ? REACT_NAMESPACE_BINDING_RESOLUTION
      : LOCAL_BINDING_RESOLUTION;
  }
  if (ts.isImportClause(node) && node.name?.text === identifierName) {
    return getModuleSource(node) === REACT_MODULE_SOURCE
      ? REACT_NAMESPACE_BINDING_RESOLUTION
      : LOCAL_BINDING_RESOLUTION;
  }
  return null;
};

const getDeclarationResolution = (
  node: ts.Node,
  identifierName: string,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): BindingResolution | null => {
  const importResolution = getImportResolution(node, identifierName);
  if (importResolution) return importResolution;

  if (ts.isVariableDeclaration(node)) {
    return getVariableDeclarationResolution(
      node,
      identifierName,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    );
  }
  if (ts.isParameter(node)) {
    return bindingNameHasIdentifier(node.name, identifierName) ? LOCAL_BINDING_RESOLUTION : null;
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === identifierName) {
    return LOCAL_BINDING_RESOLUTION;
  }
  if (ts.isClassDeclaration(node) && node.name?.text === identifierName) {
    return LOCAL_BINDING_RESOLUTION;
  }
  return null;
};

const isNestedScopeBoundary = (node: ts.Node, scopeNode: ts.Node): boolean =>
  node !== scopeNode && isScopeBoundary(node);

const findResolutionInSubtree = (
  node: ts.Node,
  scopeNode: ts.Node,
  identifierName: string,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): BindingResolution | null => {
  const declarationResolution = getDeclarationResolution(
    node,
    identifierName,
    reactImportBindings,
    sourceFile,
    visitedDeclarations,
  );
  if (declarationResolution) return declarationResolution;
  if (isNestedScopeBoundary(node, scopeNode)) return null;

  let resolution: BindingResolution | null = null;
  ts.forEachChild(node, (child) => {
    if (resolution) return;
    resolution = findResolutionInSubtree(
      child,
      scopeNode,
      identifierName,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    );
  });
  return resolution;
};

const findResolutionInFunctionParameters = (
  node: ts.Node,
  identifierName: string,
  reactImportBindings: ReactImportBindings,
): BindingResolution | null => {
  if (!ts.isFunctionLike(node)) return null;
  for (const parameter of node.parameters) {
    const parameterResolution = getDeclarationResolution(
      parameter,
      identifierName,
      reactImportBindings,
      parameter.getSourceFile(),
      new Set(),
    );
    if (parameterResolution) return parameterResolution;
  }
  return null;
};

const findResolutionInScope = (
  scopeNode: ts.Node,
  identifierName: string,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations: Set<ts.Node>,
): BindingResolution | null => {
  const parameterResolution = findResolutionInFunctionParameters(
    scopeNode,
    identifierName,
    reactImportBindings,
  );
  if (parameterResolution) return parameterResolution;

  let resolution: BindingResolution | null = null;
  ts.forEachChild(scopeNode, (child) => {
    if (resolution) return;
    resolution = findResolutionInSubtree(
      child,
      scopeNode,
      identifierName,
      reactImportBindings,
      sourceFile,
      visitedDeclarations,
    );
  });
  return resolution;
};

const isScopeNode = isScopeBoundary;

const resolveIdentifierBinding = (
  identifier: ts.Identifier,
  reactImportBindings: ReactImportBindings,
  sourceFile: ts.SourceFile,
  visitedDeclarations = new Set<ts.Node>(),
): BindingResolution | null => {
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode) {
    if (isScopeNode(currentNode)) {
      const resolution = findResolutionInScope(
        currentNode,
        identifier.text,
        reactImportBindings,
        sourceFile,
        visitedDeclarations,
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
  return resolveIdentifierBinding(
    useIdentifier,
    collectReactImportBindings(sourceFile),
    sourceFile,
  );
};
