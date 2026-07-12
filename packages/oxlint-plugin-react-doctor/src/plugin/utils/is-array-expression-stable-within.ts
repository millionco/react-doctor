import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenNativeArrayExpression } from "./is-proven-native-array-expression.js";
import { isStableLocalArrayLookupReceiver } from "./is-stable-local-array-lookup-receiver.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const MUTATING_ARRAY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const SAFE_ARRAY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "reduce",
  "reduceRight",
  "slice",
  "some",
  "toLocaleString",
  "toReversed",
  "toSorted",
  "toSpliced",
  "toString",
  "values",
  "with",
]);

const SYNCHRONOUS_ARRAY_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

const OBJECT_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "setPrototypeOf",
]);

const REFLECT_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "defineProperty",
  "deleteProperty",
  "set",
  "setPrototypeOf",
]);

const DEFERRED_GLOBAL_CALLBACK_NAMES: ReadonlySet<string> = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);

interface LoopInstabilityIndex {
  unsafeKeys: Set<string>;
}

const indexByLoop = new WeakMap<EsTreeNode, WeakMap<ScopeAnalysis, LoopInstabilityIndex>>();

const getCanonicalExpressionKey = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedBindings = new Set<EsTreeNode>(),
): string | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "ThisExpression")) return "this";
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol) return null;
    if (
      symbol.kind === "const" &&
      symbol.initializer &&
      !visitedBindings.has(symbol.bindingIdentifier) &&
      (isNodeOfType(stripParenExpression(symbol.initializer), "Identifier") ||
        isNodeOfType(stripParenExpression(symbol.initializer), "MemberExpression"))
    ) {
      visitedBindings.add(symbol.bindingIdentifier);
      const initializerKey = getCanonicalExpressionKey(symbol.initializer, scopes, visitedBindings);
      if (initializerKey) return initializerKey;
    }
    return `binding:${symbol.bindingIdentifier.range[0]}:${symbol.bindingIdentifier.range[1]}`;
  }
  if (!isNodeOfType(strippedExpression, "MemberExpression")) return null;
  const objectKey = getCanonicalExpressionKey(strippedExpression.object, scopes, visitedBindings);
  const propertyName = getStaticPropertyName(strippedExpression);
  if (!objectKey || propertyName === null) return null;
  return `${objectKey}.${propertyName}`;
};

const collectExpressionKeys = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  keys: Set<string>,
): void => {
  const candidateKeys = new Set<string>();
  walkAst(expression, (node) => {
    if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "MemberExpression")) return;
    const key = getCanonicalExpressionKey(node, scopes);
    if (key) candidateKeys.add(key);
  });
  const prefixKeys = new Set<string>();
  for (const candidateKey of candidateKeys) {
    let separatorIndex = candidateKey.lastIndexOf(".");
    while (separatorIndex !== -1) {
      prefixKeys.add(candidateKey.slice(0, separatorIndex));
      separatorIndex = candidateKey.lastIndexOf(".", separatorIndex - 1);
    }
  }
  for (const candidateKey of candidateKeys) {
    if (!prefixKeys.has(candidateKey)) keys.add(candidateKey);
  }
};

const collectEscapedExpressionKeys = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  keys: Set<string>,
): void => {
  const strippedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(strippedExpression, "Identifier") ||
    isNodeOfType(strippedExpression, "MemberExpression")
  ) {
    const key = getCanonicalExpressionKey(strippedExpression, scopes);
    if (key) keys.add(key);
    return;
  }
  if (isNodeOfType(strippedExpression, "ArrayExpression")) {
    for (const element of strippedExpression.elements) {
      if (element && !isNodeOfType(element, "SpreadElement")) {
        collectEscapedExpressionKeys(element, scopes, keys);
      }
    }
    return;
  }
  if (!isNodeOfType(strippedExpression, "ObjectExpression")) return;
  for (const property of strippedExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      collectEscapedExpressionKeys(property.argument, scopes, keys);
    } else if (isNodeOfType(property, "Property")) {
      collectEscapedExpressionKeys(property.value, scopes, keys);
    }
  }
};

const isGlobalMutationApi = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const strippedCallee = stripParenExpression(callee);
  if (!isNodeOfType(strippedCallee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(strippedCallee);
  const object = stripParenExpression(strippedCallee.object);
  if (!methodName || !isNodeOfType(object, "Identifier") || !scopes.isGlobalReference(object)) {
    return false;
  }
  return (
    (object.name === "Object" && OBJECT_MUTATION_METHOD_NAMES.has(methodName)) ||
    (object.name === "Reflect" && REFLECT_MUTATION_METHOD_NAMES.has(methodName))
  );
};

const getWriteTarget = (node: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(node, "AssignmentExpression")) return node.left;
  if (isNodeOfType(node, "UpdateExpression")) return node.argument;
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") return node.argument;
  if (
    (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) &&
    !isNodeOfType(node.left, "VariableDeclaration")
  ) {
    return node.left;
  }
  return null;
};

const hasNestedFunctionBoundary = (node: EsTreeNode, root: EsTreeNode): boolean => {
  if (node === root) return false;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== root) {
    if (isFunctionLike(ancestor)) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const getFunctionArgument = (argument: EsTreeNode): EsTreeNode | null => {
  const strippedArgument = stripParenExpression(argument);
  if (isFunctionLike(strippedArgument)) return strippedArgument;
  if (!isNodeOfType(strippedArgument, "Identifier")) return null;
  const initializer = findVariableInitializer(strippedArgument, strippedArgument.name)?.initializer;
  if (!initializer) return null;
  const strippedInitializer = stripParenExpression(initializer);
  return isFunctionLike(strippedInitializer) ? strippedInitializer : null;
};

const isKnownDeferredCallbackCall = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  return (
    isNodeOfType(callee, "Identifier") &&
    scopes.isGlobalReference(callee) &&
    DEFERRED_GLOBAL_CALLBACK_NAMES.has(callee.name)
  );
};

const addWriteTarget = (
  target: EsTreeNode,
  scopes: ScopeAnalysis,
  unsafeKeys: Set<string>,
): void => {
  collectExpressionKeys(target, scopes, unsafeKeys);
  walkAst(target, (node) => {
    if (!isNodeOfType(node, "Identifier")) return;
    const binding = findVariableInitializer(node, node.name);
    if (binding?.initializer) collectExpressionKeys(binding.initializer, scopes, unsafeKeys);
  });
};

const buildLoopInstabilityIndex = (
  loop: EsTreeNode,
  scopes: ScopeAnalysis,
): LoopInstabilityIndex => {
  const unsafeKeys = new Set<string>();
  const visitedFunctions = new Set<EsTreeNode>();
  const analyzeRoot = (root: EsTreeNode): void => {
    walkAst(root, (node) => {
      if (hasNestedFunctionBoundary(node, root)) return;
      const writeTarget = getWriteTarget(node);
      if (writeTarget) addWriteTarget(writeTarget, scopes, unsafeKeys);
      if (isNodeOfType(node, "AssignmentExpression")) {
        collectEscapedExpressionKeys(node.right, scopes, unsafeKeys);
      }
      if (
        (isNodeOfType(node, "ReturnStatement") ||
          isNodeOfType(node, "ThrowStatement") ||
          isNodeOfType(node, "YieldExpression")) &&
        node.argument
      ) {
        collectEscapedExpressionKeys(node.argument, scopes, unsafeKeys);
      }
      if (!isNodeOfType(node, "CallExpression")) return;
      if (isGlobalMutationApi(node.callee, scopes)) {
        const target = node.arguments[0];
        if (target && !isNodeOfType(target, "SpreadElement")) {
          collectExpressionKeys(target, scopes, unsafeKeys);
        }
        return;
      }
      const callee = stripParenExpression(node.callee);
      let methodName: string | null = null;
      let hasProvenNativeCallbackDispatch: boolean | undefined;
      if (isFunctionLike(callee) && !visitedFunctions.has(callee)) {
        visitedFunctions.add(callee);
        analyzeRoot(callee.body);
      } else if (isNodeOfType(callee, "MemberExpression")) {
        methodName = getStaticPropertyName(callee);
        if (methodName && MUTATING_ARRAY_METHOD_NAMES.has(methodName)) {
          collectExpressionKeys(callee.object, scopes, unsafeKeys);
        } else if (!methodName || !SAFE_ARRAY_METHOD_NAMES.has(methodName)) {
          collectExpressionKeys(callee.object, scopes, unsafeKeys);
        }
      } else if (isNodeOfType(callee, "Identifier")) {
        const binding = findVariableInitializer(callee, callee.name);
        const initializer = binding?.initializer && stripParenExpression(binding.initializer);
        if (initializer && isFunctionLike(initializer) && !visitedFunctions.has(initializer)) {
          visitedFunctions.add(initializer);
          analyzeRoot(initializer.body);
        }
      }
      for (const argument of node.arguments) {
        const callback = getFunctionArgument(argument);
        if (callback && hasProvenNativeCallbackDispatch === undefined) {
          hasProvenNativeCallbackDispatch =
            isNodeOfType(callee, "MemberExpression") &&
            (isProvenNativeArrayExpression(callee.object) ||
              Boolean(
                methodName &&
                isStableLocalArrayLookupReceiver(
                  callee.object,
                  loop,
                  scopes,
                  SAFE_ARRAY_METHOD_NAMES,
                  methodName,
                ),
              ));
        }
        const hasProvenSynchronousCallbackDispatch = Boolean(
          methodName &&
          SYNCHRONOUS_ARRAY_CALLBACK_METHOD_NAMES.has(methodName) &&
          hasProvenNativeCallbackDispatch,
        );
        const hasUnknownCallbackDispatch =
          !hasProvenNativeCallbackDispatch && !isKnownDeferredCallbackCall(callee, scopes);
        if (hasProvenSynchronousCallbackDispatch || hasUnknownCallbackDispatch) {
          if (callback && isFunctionLike(callback) && !visitedFunctions.has(callback)) {
            visitedFunctions.add(callback);
            analyzeRoot(callback.body);
          }
        }
        if (!isNodeOfType(argument, "SpreadElement") && !isFunctionLike(argument)) {
          collectEscapedExpressionKeys(argument, scopes, unsafeKeys);
        }
      }
    });
  };
  analyzeRoot(loop);
  return { unsafeKeys };
};

const keysOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

export const isArrayExpressionStableWithin = (
  expression: EsTreeNode,
  loop: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const expressionKey = getCanonicalExpressionKey(expression, scopes);
  if (!expressionKey) return false;
  let indexByAnalysis = indexByLoop.get(loop);
  if (!indexByAnalysis) {
    indexByAnalysis = new WeakMap();
    indexByLoop.set(loop, indexByAnalysis);
  }
  let index = indexByAnalysis.get(scopes);
  if (!index) {
    index = buildLoopInstabilityIndex(loop, scopes);
    indexByAnalysis.set(scopes, index);
  }
  for (const unsafeKey of index.unsafeKeys) {
    if (keysOverlap(expressionKey, unsafeKey)) return false;
  }
  return true;
};
