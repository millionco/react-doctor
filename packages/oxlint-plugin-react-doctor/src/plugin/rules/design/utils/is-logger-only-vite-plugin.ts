import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isLoggerOnlyVitePlugin = (
  functionNode: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length
  )
    return false;
  const returned = getSingleReturnExpression(functionNode);
  const object = returned && stripParenExpression(returned);
  if (!isNodeOfType(object, "ObjectExpression")) return false;
  let callback: EsTreeNode | null = null;
  const names = new Set<string>();
  for (const property of object.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init") return false;
    const name = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!name || names.has(name)) return false;
    names.add(name);
    if (name === "name" || name === "apply") {
      if (getStaticStringExpression(property.value) === null) return false;
    } else if (name === "configResolved") {
      callback = property.value;
    } else return false;
  }
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 1
  )
    return false;
  const parameter = callback.params[0];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const configSymbol = scopes.symbolFor(parameter);
  if (
    !configSymbol ||
    !isSymbolReadOnly(configSymbol) ||
    !hasCompleteSymbolReferences(configSymbol, program, scopes)
  )
    return false;
  const isLogger = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "MemberExpression") &&
    getStaticPropertyName(node) === "logger" &&
    isNodeOfType(node.object, "Identifier") &&
    scopes.symbolFor(node.object) === configSymbol;
  const isWarn = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "MemberExpression") &&
    getStaticPropertyName(node) === "warn" &&
    isLogger(node.object);
  const isStringTest = (node: EsTreeNode): boolean => {
    if (
      !isNodeOfType(node, "MemberExpression") ||
      getStaticPropertyName(node) !== "includes" ||
      !isNodeOfType(node.object, "Identifier")
    )
      return false;
    const symbol = scopes.symbolFor(node.object);
    if (!symbol || symbol.kind !== "parameter") return false;
    let owner = node.parent;
    while (owner && !isFunctionLike(owner)) owner = owner.parent;
    if (
      !isFunctionLike(owner) ||
      !isNodeOfType(owner.parent, "AssignmentExpression") ||
      !isWarn(owner.parent.left)
    )
      return false;
    return (
      owner.params[0] === symbol.bindingIdentifier &&
      isSymbolReadOnly(symbol) &&
      hasCompleteSymbolReferences(symbol, program, scopes)
    );
  };
  let isClosed = true;
  walkAst(callback, (node) => {
    if (!isClosed || isKeyedDraftTypeReference(node)) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      if (!isLogger(node) && !isWarn(node) && !isStringTest(node)) isClosed = false;
    } else if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      isClosed = false;
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isWarn(callee)) return;
      if (isStringTest(callee)) {
        if (!node.arguments.every((argument) => getStaticStringExpression(argument) !== null))
          isClosed = false;
        return;
      }
      const symbol = isNodeOfType(callee, "Identifier") ? scopes.symbolFor(callee) : null;
      const initializer = symbol && getDirectConstInitializer(symbol);
      if (
        !symbol ||
        !initializer ||
        !isWarn(initializer) ||
        !isSymbolReadOnly(symbol) ||
        !hasCompleteSymbolReferences(symbol, program, scopes)
      )
        isClosed = false;
    } else if (isNodeOfType(node, "AssignmentExpression")) {
      if (node.operator !== "=" || !isWarn(node.left) || !isFunctionLike(node.right))
        isClosed = false;
    } else if (
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    )
      isClosed = false;
  });
  return isClosed;
};
