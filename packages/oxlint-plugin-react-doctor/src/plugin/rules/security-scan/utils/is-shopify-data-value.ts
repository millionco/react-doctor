import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getShopifyDataProperties } from "./get-shopify-data-properties.js";
import {
  SHOPIFY_API_MODULE,
  SHOPIFY_MAX_DATA_DEPTH,
  SHOPIFY_RAW_REPLACE_ARGUMENT_COUNT,
} from "./shopify-webhook-constants.js";

const readonlyReferenceProofsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, boolean>
>();

export const isShopifyDataValue = (
  value: EsTreeNode,
  scopes: ScopeAnalysis,
  allowImportedData = false,
  visited = new Set<EsTreeNode>(),
  depth = 0,
): boolean => {
  if (depth > SHOPIFY_MAX_DATA_DEPTH) return false;
  const node = stripParenExpression(value);
  if (!node || visited.has(node)) return false;
  const nextVisited = new Set(visited).add(node);
  const readChild = (child: EsTreeNode): boolean =>
    isShopifyDataValue(child, scopes, allowImportedData, nextVisited, depth + 1);
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every(
      (element) =>
        element !== null && !isNodeOfType(element, "SpreadElement") && readChild(element),
    );
  if (isNodeOfType(node, "ObjectExpression")) {
    const properties = getShopifyDataProperties(node, scopes);
    return properties !== null && [...properties.values()].every(readChild);
  }
  if (isNodeOfType(node, "Identifier")) {
    const symbol = scopes.symbolFor(node);
    if (!symbol) return node.name === "undefined" && scopes.isGlobalReference(node);
    if (
      allowImportedData &&
      getValueImportSource(symbol) &&
      getValueImportSource(symbol) !== SHOPIFY_API_MODULE
    )
      return true;
    if (symbol.kind !== "const" || symbol.initializer === null) return false;
    let readonlyBySymbol = readonlyReferenceProofsByScopes.get(scopes);
    if (!readonlyBySymbol) {
      readonlyBySymbol = new WeakMap();
      readonlyReferenceProofsByScopes.set(scopes, readonlyBySymbol);
    }
    let hasReadonlyReferences = readonlyBySymbol.get(symbol);
    if (hasReadonlyReferences === undefined) {
      hasReadonlyReferences = symbol.references.every((reference) => reference.flag === "read");
      readonlyBySymbol.set(symbol, hasReadonlyReferences);
    }
    return hasReadonlyReferences && readChild(symbol.initializer);
  }
  if (isNodeOfType(node, "ConditionalExpression"))
    return readChild(node.test) && readChild(node.consequent) && readChild(node.alternate);
  if (isNodeOfType(node, "BinaryExpression"))
    return (
      ["===", "!==", "==", "!="].includes(node.operator) &&
      readChild(node.left) &&
      readChild(node.right)
    );
  if (isNodeOfType(node, "MemberExpression") && !node.optional && !node.computed) {
    const receiver = node.object;
    if (
      isNodeOfType(receiver, "MemberExpression") &&
      !receiver.computed &&
      !receiver.optional &&
      isNodeOfType(receiver.object, "Identifier") &&
      receiver.object.name === "process" &&
      scopes.isGlobalReference(receiver.object) &&
      isNodeOfType(receiver.property, "Identifier") &&
      receiver.property.name === "env"
    )
      return true;
    if (isNodeOfType(receiver, "Identifier")) {
      const symbol = scopes.symbolFor(receiver);
      return Boolean(
        symbol &&
        getValueImportSource(symbol) === SHOPIFY_API_MODULE &&
        isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        getImportedName(symbol.declarationNode) === "LogSeverity",
      );
    }
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    !node.optional &&
    node.arguments.length === SHOPIFY_RAW_REPLACE_ARGUMENT_COUNT &&
    isNodeOfType(node.callee, "MemberExpression") &&
    !node.callee.computed &&
    !node.callee.optional &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "replace" &&
    readChild(node.callee.object)
  ) {
    return node.arguments.every((argument) => isNodeOfType(argument, "Literal"));
  }
  return false;
};
