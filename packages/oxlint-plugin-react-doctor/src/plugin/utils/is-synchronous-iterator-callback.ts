import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const SYNCHRONOUS_ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

const EAGER_ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  ...SYNCHRONOUS_ITERATOR_METHOD_NAMES,
  "find",
  "findIndex",
  "sort",
]);

const ARRAY_RETURNING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "concat",
  "filter",
  "flat",
  "flatMap",
  "map",
  "slice",
  "sort",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const EAGER_COLLECTION_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "BigInt64Array",
  "BigUint64Array",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
]);

const EAGER_FOR_EACH_COLLECTION_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  ...EAGER_COLLECTION_CONSTRUCTOR_NAMES,
  "Map",
  "Set",
]);

const isGlobalIdentifierNamed = (
  expression: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    isNodeOfType(candidate, "Identifier") &&
    candidate.name === name &&
    scopes.isGlobalReference(candidate)
  );
};

const isArrayFactoryCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    (methodName === "from" || methodName === "of") &&
    isGlobalIdentifierNamed(callee.object, "Array", scopes),
  );
};

const isObjectArrayFactoryCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    methodName &&
    ["entries", "keys", "values"].includes(methodName) &&
    isGlobalIdentifierNamed(callee.object, "Object", scopes),
  );
};

const isProvablyEmptyEagerCollection = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ArrayExpression")) return candidate.elements.length === 0;
  if (isNodeOfType(candidate, "NewExpression")) {
    const callee = stripParenExpression(candidate.callee);
    return Boolean(
      candidate.arguments.length === 0 &&
      isNodeOfType(callee, "Identifier") &&
      EAGER_FOR_EACH_COLLECTION_CONSTRUCTOR_NAMES.has(callee.name) &&
      scopes.isGlobalReference(callee),
    );
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    if (isArrayFactoryCall(candidate, scopes)) {
      const factoryMethodName = isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
      if (factoryMethodName === "of") return candidate.arguments.length === 0;
      const source = candidate.arguments[0];
      return Boolean(
        source &&
        !isNodeOfType(source, "SpreadElement") &&
        isProvablyEmptyEagerCollection(source, scopes, visitedSymbolIds),
      );
    }
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) !== "concat" &&
      ARRAY_RETURNING_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isProvablyEmptyEagerCollection(callee.object, scopes, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isProvablyEmptyEagerCollection(symbol.initializer, scopes, visitedSymbolIds);
};

const isProvablyEagerCollection = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ArrayExpression")) return true;
  if (isNodeOfType(candidate, "NewExpression")) {
    const callee = stripParenExpression(candidate.callee);
    return Boolean(
      isNodeOfType(callee, "Identifier") &&
      EAGER_COLLECTION_CONSTRUCTOR_NAMES.has(callee.name) &&
      scopes.isGlobalReference(callee),
    );
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    if (isArrayFactoryCall(candidate, scopes) || isObjectArrayFactoryCall(candidate, scopes)) {
      return true;
    }
    const callee = stripParenExpression(candidate.callee);
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      ARRAY_RETURNING_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isProvablyEagerCollection(callee.object, scopes, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isProvablyEagerCollection(symbol.initializer, scopes, visitedSymbolIds);
};

const isProvablyEagerForEachCollection = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "NewExpression")) {
    if (!isNodeOfType(candidate, "Identifier")) {
      return isProvablyEagerCollection(candidate, scopes, visitedSymbolIds);
    }
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isProvablyEagerForEachCollection(symbol.initializer, scopes, visitedSymbolIds);
  }
  const callee = stripParenExpression(candidate.callee);
  return Boolean(
    isNodeOfType(callee, "Identifier") &&
    EAGER_FOR_EACH_COLLECTION_CONSTRUCTOR_NAMES.has(callee.name) &&
    scopes.isGlobalReference(callee),
  );
};

export const isSynchronousIteratorCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  callbackArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (
    methodName === "from" &&
    isGlobalIdentifierNamed(callee.object, "Array", scopes) &&
    callNode.arguments[1] === callbackArgument
  ) {
    const source = callNode.arguments[0];
    return Boolean(
      source &&
      !isNodeOfType(source, "SpreadElement") &&
      !isProvablyEmptyEagerCollection(source, scopes),
    );
  }
  return Boolean(
    methodName &&
    EAGER_ITERATOR_METHOD_NAMES.has(methodName) &&
    callNode.arguments[0] === callbackArgument &&
    !isProvablyEmptyEagerCollection(callee.object, scopes) &&
    (methodName === "forEach"
      ? isProvablyEagerForEachCollection(callee.object, scopes)
      : isProvablyEagerCollection(callee.object, scopes)),
  );
};

export const isSynchronousIteratorCallback = (functionNode: EsTreeNode): boolean => {
  const callNode = functionNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    callee.property.name === "from"
  ) {
    return callNode.arguments[1] === functionNode;
  }
  return (
    SYNCHRONOUS_ITERATOR_METHOD_NAMES.has(callee.property.name) &&
    callNode.arguments[0] === functionNode
  );
};
