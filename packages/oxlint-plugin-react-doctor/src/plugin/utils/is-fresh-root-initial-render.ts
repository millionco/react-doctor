import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findImmediatelyInvokedCallExpression } from "./find-immediately-invoked-call-expression.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isDirectImportedApiCall = (
  node: EsTreeNode,
  source: string,
  importedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  const importedApi = resolveImportedApiReference(callee, scopes);
  if (importedApi?.source !== source || importedApi.importedName !== importedName) return false;
  const identifier = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "import" || !isSymbolReadOnly(symbol)) return false;
  if (
    isNodeOfType(callee, "MemberExpression")
      ? !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
      : !isNodeOfType(symbol.declarationNode, "ImportSpecifier")
  ) {
    return false;
  }
  return symbol.references.every((reference) => {
    let expression = findTransparentExpressionRoot(reference.identifier);
    if (isNodeOfType(callee, "MemberExpression")) {
      const member = expression.parent;
      if (!isNodeOfType(member, "MemberExpression") || member.object !== expression) return false;
      expression = findTransparentExpressionRoot(member);
    }
    const call = expression.parent;
    const api = resolveImportedApiReference(expression, scopes);
    return (
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.callee === expression &&
      api?.source === source &&
      api.importedName === importedName
    );
  });
};

const hasUncertainReactExecutionContext = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const pendingNodes = [node];
  const visitedAncestors = new Set<EsTreeNode>();
  while (pendingNodes.length) {
    let ancestor = pendingNodes.pop()?.parent;
    while (ancestor && !visitedAncestors.has(ancestor)) {
      visitedAncestors.add(ancestor);
      if (isNodeOfType(ancestor, "ClassBody")) return true;
      if (isFunctionLike(ancestor)) {
        const functionValue = findTransparentExpressionRoot(ancestor);
        const parent = functionValue.parent;
        const directSymbol =
          isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")
            ? scopes.symbolFor(parent.id)
            : null;
        const initializer = directSymbol ? getDirectConstInitializer(directSymbol) : null;
        const isPrivateDeclaration =
          isNodeOfType(ancestor, "FunctionDeclaration") &&
          (isNodeOfType(parent, "BlockStatement") || isNodeOfType(parent, "Program"));
        const isConstInitializer = Boolean(
          initializer &&
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === functionValue &&
          stripParenExpression(initializer) === ancestor &&
          directSymbol &&
          isSymbolReadOnly(directSymbol),
        );
        const immediateCall = findImmediatelyInvokedCallExpression(ancestor);
        if (
          ancestor.async ||
          ancestor.generator ||
          componentOrHookDisplayNameForFunction(ancestor) ||
          (!isPrivateDeclaration &&
            !isConstInitializer &&
            !(immediateCall && !immediateCall.optional))
        ) {
          return true;
        }
        const functionSymbols = getFunctionBindingSymbols(ancestor, scopes);
        if (directSymbol && !functionSymbols.includes(directSymbol))
          functionSymbols.push(directSymbol);
        if (
          (isNodeOfType(ancestor, "FunctionDeclaration") ||
            isNodeOfType(ancestor, "FunctionExpression")) &&
          ancestor.id
        ) {
          const selfSymbol = scopes.symbolFor(ancestor.id);
          if (selfSymbol && !functionSymbols.includes(selfSymbol)) functionSymbols.push(selfSymbol);
        }
        for (const symbol of functionSymbols) {
          const declaration = symbol.declarationNode.parent;
          if (
            isNodeOfType(declaration, "VariableDeclaration") &&
            isNodeOfType(declaration.parent, "ExportNamedDeclaration")
          ) {
            return true;
          }
          for (const reference of symbol.references) {
            const expression = findTransparentExpressionRoot(reference.identifier);
            const call = expression.parent;
            if (
              reference.flag !== "read" ||
              !isNodeOfType(call, "CallExpression") ||
              call.callee !== expression
            ) {
              return true;
            }
            pendingNodes.push(reference.identifier);
          }
        }
      }
      ancestor = ancestor.parent;
    }
  }
  return false;
};

const isPrecomputedRenderNode = (argument: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const node = stripParenExpression(argument);
  if (isNodeOfType(node, "Literal")) {
    if (("regex" in node && Boolean(node.regex)) || ("bigint" in node && Boolean(node.bigint))) {
      return false;
    }
    return (
      node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean"
    );
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (!symbol) return false;
  if (symbol.kind === "parameter") return true;
  if (!isSymbolReadOnly(symbol)) return false;
  if (getValueImportDeclaration(symbol)) return true;
  const initializer = getDirectConstInitializer(symbol);
  const declarationEnd = getNodeEndIndex(symbol.declarationNode);
  return Boolean(initializer && declarationEnd > 0 && declarationEnd <= getNodeStartIndex(node));
};

export const isFreshRootInitialRender = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isDirectImportedApiCall(node, "react-dom", "flushSync", scopes) ||
    !isNodeOfType(node, "CallExpression") ||
    hasUncertainReactExecutionContext(node, scopes)
  ) {
    return false;
  }
  const [callbackValue, ...otherArguments] = node.arguments;
  if (!callbackValue || otherArguments.length) return false;
  const callback = stripParenExpression(callbackValue);
  if (!isFunctionLike(callback) || callback.async || callback.generator || callback.params.length) {
    return false;
  }
  let renderExpression = callback.body;
  if (isNodeOfType(renderExpression, "BlockStatement")) {
    const [statement, ...otherStatements] = renderExpression.body;
    if (!isNodeOfType(statement, "ExpressionStatement") || otherStatements.length) return false;
    renderExpression = statement.expression;
  }
  const renderCall = stripParenExpression(renderExpression);
  if (!isNodeOfType(renderCall, "CallExpression") || renderCall.optional) return false;
  const renderCallee = stripParenExpression(renderCall.callee);
  if (
    !isNodeOfType(renderCallee, "MemberExpression") ||
    renderCallee.optional ||
    getStaticPropertyName(renderCallee) !== "render"
  ) {
    return false;
  }
  const [renderArgument, ...otherRenderArguments] = renderCall.arguments;
  if (
    !renderArgument ||
    otherRenderArguments.length ||
    !isPrecomputedRenderNode(renderArgument, scopes)
  ) {
    return false;
  }
  const rootIdentifier = stripParenExpression(renderCallee.object);
  if (!isNodeOfType(rootIdentifier, "Identifier")) return false;
  const rootSymbol = scopes.symbolFor(rootIdentifier);
  if (
    !rootSymbol ||
    !isSymbolReadOnly(rootSymbol) ||
    !rootSymbol.references.every((reference) => reference.identifier === rootIdentifier)
  ) {
    return false;
  }
  const rootInitializer = getDirectConstInitializer(rootSymbol);
  if (
    !rootInitializer ||
    !isDirectImportedApiCall(
      stripParenExpression(rootInitializer),
      "react-dom/client",
      "createRoot",
      scopes,
    )
  ) {
    return false;
  }
  const rootDeclaration = rootSymbol.declarationNode.parent;
  const flushStatement = findTransparentExpressionRoot(node).parent;
  if (
    !isNodeOfType(rootDeclaration, "VariableDeclaration") ||
    !isNodeOfType(flushStatement, "ExpressionStatement") ||
    rootDeclaration.parent !== flushStatement.parent
  ) {
    return false;
  }
  const [declarator, ...otherDeclarators] = rootDeclaration.declarations;
  if (declarator !== rootSymbol.declarationNode || otherDeclarators.length) return false;
  const block = rootDeclaration.parent;
  if (!isNodeOfType(block, "BlockStatement") && !isNodeOfType(block, "Program")) return false;
  let followsDeclaration = false;
  for (const statement of block.body) {
    if (followsDeclaration) return statement === flushStatement;
    followsDeclaration = statement === rootDeclaration;
  }
  return false;
};
