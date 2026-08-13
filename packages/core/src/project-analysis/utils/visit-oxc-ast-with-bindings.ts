import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

const collectBindingNames = (pattern: unknown, bindingNames: Set<string>): void => {
  if (!isOxcAstNode(pattern)) return;
  const identifierName = getIdentifierName(pattern);
  if (identifierName) {
    bindingNames.add(identifierName);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectBindingNames(pattern.left, bindingNames);
    return;
  }
  if (pattern.type === "RestElement") {
    collectBindingNames(pattern.argument, bindingNames);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    for (const element of elements) collectBindingNames(element, bindingNames);
    return;
  }
  if (pattern.type !== "ObjectPattern") return;
  const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
  for (const property of properties) {
    if (!isOxcAstNode(property)) continue;
    collectBindingNames(
      property.type === "Property" ? property.value : property.argument,
      bindingNames,
    );
  }
};

const collectDirectScopeBindingNames = (
  statements: unknown[],
  bindingNames: Set<string>,
  includeVarBindings: boolean,
): void => {
  for (const statementValue of statements) {
    if (!isOxcAstNode(statementValue)) continue;
    const statement =
      statementValue.type === "ExportNamedDeclaration" && isOxcAstNode(statementValue.declaration)
        ? statementValue.declaration
        : statementValue;
    if (
      statement.type === "VariableDeclaration" &&
      (includeVarBindings || statement.kind !== "var")
    ) {
      const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
      for (const declaration of declarations) {
        if (isOxcAstNode(declaration)) collectBindingNames(declaration.id, bindingNames);
      }
      continue;
    }
    if (
      statement.type === "FunctionDeclaration" ||
      statement.type === "ClassDeclaration" ||
      statement.type === "ImportDeclaration"
    ) {
      collectBindingNames(statement.id, bindingNames);
      const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
      for (const specifier of specifiers) {
        if (isOxcAstNode(specifier)) collectBindingNames(specifier.local, bindingNames);
      }
    }
  }
};

const collectHoistedVarBindingNames = (value: unknown, bindingNames: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const child of value) collectHoistedVarBindingNames(child, bindingNames);
    return;
  }
  if (!isOxcAstNode(value)) return;
  if (
    value.type === "FunctionDeclaration" ||
    value.type === "FunctionExpression" ||
    value.type === "ArrowFunctionExpression" ||
    value.type === "ClassDeclaration" ||
    value.type === "ClassExpression" ||
    value.type === "StaticBlock"
  ) {
    return;
  }
  if (value.type === "VariableDeclaration" && value.kind === "var") {
    const declarations = Array.isArray(value.declarations) ? value.declarations : [];
    for (const declaration of declarations) {
      if (isOxcAstNode(declaration)) collectBindingNames(declaration.id, bindingNames);
    }
  }
  for (const child of Object.values(value)) collectHoistedVarBindingNames(child, bindingNames);
};

const collectProgramBindingNames = (statements: unknown[]): Set<string> => {
  const bindingNames = new Set<string>();
  collectDirectScopeBindingNames(statements, bindingNames, true);
  for (const statement of statements) {
    if (
      isOxcAstNode(statement) &&
      statement.type !== "FunctionDeclaration" &&
      statement.type !== "FunctionExpression" &&
      statement.type !== "ArrowFunctionExpression"
    ) {
      collectHoistedVarBindingNames(statement, bindingNames);
    }
  }
  return bindingNames;
};

const collectNodeScopeBindingNames = (node: OxcAstNode): Set<string> => {
  const bindingNames = new Set<string>();
  if (node.type === "Program" && Array.isArray(node.body)) {
    return collectProgramBindingNames(node.body);
  }
  if (node.type === "BlockStatement" && Array.isArray(node.body)) {
    collectDirectScopeBindingNames(node.body, bindingNames, false);
  }
  if (node.type === "StaticBlock" && Array.isArray(node.body)) {
    collectDirectScopeBindingNames(node.body, bindingNames, true);
    collectHoistedVarBindingNames(node.body, bindingNames);
  }
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    collectBindingNames(node.id, bindingNames);
    const parameters = Array.isArray(node.params) ? node.params : [];
    for (const parameter of parameters) collectBindingNames(parameter, bindingNames);
    if (isOxcAstNode(node.body)) {
      collectHoistedVarBindingNames(node.body.body, bindingNames);
    }
  }
  if (node.type === "CatchClause") collectBindingNames(node.param, bindingNames);
  if (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const declaration = isOxcAstNode(node.init) ? node.init : node.left;
    if (
      isOxcAstNode(declaration) &&
      declaration.type === "VariableDeclaration" &&
      declaration.kind !== "var"
    ) {
      const declarations = Array.isArray(declaration.declarations) ? declaration.declarations : [];
      for (const variableDeclaration of declarations) {
        if (isOxcAstNode(variableDeclaration))
          collectBindingNames(variableDeclaration.id, bindingNames);
      }
    }
  }
  return bindingNames;
};

const mergeBindingNames = (
  inheritedBindings: ReadonlySet<string>,
  scopeBindings: ReadonlySet<string>,
): ReadonlySet<string> =>
  scopeBindings.size === 0 ? inheritedBindings : new Set([...inheritedBindings, ...scopeBindings]);

export const visitOxcAstWithBindings = (
  root: unknown,
  visitor: (
    node: OxcAstNode,
    bindingNames: ReadonlySet<string>,
    parentNode: OxcAstNode | undefined,
    nestedBindingNames: ReadonlySet<string>,
  ) => boolean | void,
  initialBindings: ReadonlySet<string> = new Set(),
  includeRootBindings = true,
): void => {
  const visitNode = (
    value: unknown,
    inheritedBindings: ReadonlySet<string>,
    inheritedNestedBindings: ReadonlySet<string>,
    isRoot: boolean,
    parentNode: OxcAstNode | undefined,
  ): void => {
    if (Array.isArray(value)) {
      const rootBindings =
        isRoot && includeRootBindings ? collectProgramBindingNames(value) : new Set<string>();
      const bindingNames = mergeBindingNames(inheritedBindings, rootBindings);
      for (const child of value) {
        visitNode(child, bindingNames, inheritedNestedBindings, false, parentNode);
      }
      return;
    }
    if (!isOxcAstNode(value)) return;
    const scopeBindings =
      isRoot && !includeRootBindings ? new Set<string>() : collectNodeScopeBindingNames(value);
    const bindingNames = mergeBindingNames(inheritedBindings, scopeBindings);
    const nestedBindingNames = isRoot
      ? inheritedNestedBindings
      : mergeBindingNames(inheritedNestedBindings, scopeBindings);
    if (visitor(value, bindingNames, parentNode, nestedBindingNames) === false) return;
    for (const child of Object.values(value)) {
      visitNode(child, bindingNames, nestedBindingNames, false, value);
    }
  };
  visitNode(root, initialBindings, new Set(), true, undefined);
};
