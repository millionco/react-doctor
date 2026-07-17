import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ESCAPE_ASSIGNMENT_TARGET_PROPERTIES = new Set(["href", "src", "current"]);

const MESSAGE =
  "`URL.createObjectURL(...)` pins the underlying Blob/File in memory until it is revoked, and this module never calls `URL.revokeObjectURL`. Store the URL, revoke it once you're done (in an effect cleanup, after the download, or on unmount) so the Blob can be freed.";

const isUrlMethodCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === methodName &&
    isProvenGlobalNamespaceReference(callee.object, "URL", scopes)
  );
};

const CACHE_COLLECTION_CONSTRUCTOR_NAMES = new Set(["Map", "Set"]);
const CACHE_STORE_METHOD_NAMES = new Set(["add", "set"]);
const CACHE_EVICTION_METHOD_NAMES = new Set(["clear", "delete"]);

const getModuleScopeCacheSymbolId = (node: EsTreeNode, scopes: ScopeAnalysis): number | null => {
  const cacheReference = stripParenExpression(node);
  if (!isNodeOfType(cacheReference, "Identifier")) return null;
  const symbol = scopes.symbolFor(cacheReference);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.scope.kind !== "module" ||
    !/cache/i.test(symbol.name)
  ) {
    return null;
  }
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  return initializer &&
    isNodeOfType(initializer, "NewExpression") &&
    isNodeOfType(initializer.callee, "Identifier") &&
    CACHE_COLLECTION_CONSTRUCTOR_NAMES.has(initializer.callee.name) &&
    scopes.isGlobalReference(initializer.callee)
    ? symbol.id
    : null;
};

const isModuleScopeCacheReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  getModuleScopeCacheSymbolId(node, scopes) !== null;

const isCacheStoreOfExpression = (
  call: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const storeMethodName = getStaticPropertyName(callee);
  if (
    !storeMethodName ||
    !CACHE_STORE_METHOD_NAMES.has(storeMethodName) ||
    !isModuleScopeCacheReference(callee.object, scopes)
  ) {
    return false;
  }
  const candidateExpression = stripParenExpression(expression);
  const expressionRetainsCandidate = (container: EsTreeNode): boolean => {
    const storedExpression = stripParenExpression(container);
    if (storedExpression === candidateExpression) return true;
    if (
      isNodeOfType(candidateExpression, "Identifier") &&
      isNodeOfType(storedExpression, "Identifier") &&
      scopes.symbolFor(storedExpression) === scopes.symbolFor(candidateExpression)
    ) {
      return true;
    }
    if (isNodeOfType(storedExpression, "ArrayExpression")) {
      return storedExpression.elements.some((element) => {
        if (!element) return false;
        return expressionRetainsCandidate(
          isNodeOfType(element, "SpreadElement") ? element.argument : element,
        );
      });
    }
    if (isNodeOfType(storedExpression, "ObjectExpression")) {
      return storedExpression.properties.some((property) => {
        if (isNodeOfType(property, "SpreadElement")) {
          return expressionRetainsCandidate(property.argument);
        }
        return isNodeOfType(property, "Property") && expressionRetainsCandidate(property.value);
      });
    }
    return false;
  };
  return call.arguments.some(
    (argument) => isAstNode(argument) && expressionRetainsCandidate(argument),
  );
};

const collectRetainedSymbolIds = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  symbolIds: Set<number>,
): void => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (symbol) symbolIds.add(symbol.id);
    return;
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    for (const element of candidate.elements) {
      if (!element) continue;
      collectRetainedSymbolIds(
        isNodeOfType(element, "SpreadElement") ? element.argument : element,
        scopes,
        symbolIds,
      );
    }
    return;
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return;
  for (const property of candidate.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      collectRetainedSymbolIds(property.argument, scopes, symbolIds);
    } else if (isNodeOfType(property, "Property")) {
      collectRetainedSymbolIds(property.value, scopes, symbolIds);
    }
  }
};

const findCallResultExpression = (call: EsTreeNode): EsTreeNode => {
  let resultExpression = findTransparentExpressionRoot(call);
  while (resultExpression.parent) {
    const parent = resultExpression.parent;
    if (isNodeOfType(parent, "AwaitExpression") && parent.argument === resultExpression) {
      resultExpression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "SequenceExpression") &&
      parent.expressions.at(-1) === resultExpression
    ) {
      resultExpression = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  return resultExpression;
};

const findBoundCallResult = (call: EsTreeNode): EsTreeNode | null => {
  const resultExpression = findCallResultExpression(call);
  const consumer = resultExpression.parent;
  if (
    !consumer ||
    !isNodeOfType(consumer, "VariableDeclarator") ||
    consumer.init !== resultExpression ||
    !isNodeOfType(consumer.id, "Identifier")
  ) {
    return null;
  }
  return consumer.id;
};

const isExpressionBranchOf = (parent: EsTreeNode, node: EsTreeNode): boolean =>
  (isNodeOfType(parent, "LogicalExpression") &&
    (stripParenExpression(parent.left) === stripParenExpression(node) ||
      stripParenExpression(parent.right) === stripParenExpression(node))) ||
  (isNodeOfType(parent, "ConditionalExpression") &&
    (stripParenExpression(parent.consequent) === stripParenExpression(node) ||
      stripParenExpression(parent.alternate) === stripParenExpression(node)));

const isGuardedExpressionBranchOf = (parent: EsTreeNode, node: EsTreeNode): boolean =>
  (isNodeOfType(parent, "LogicalExpression") &&
    stripParenExpression(parent.right) === stripParenExpression(node)) ||
  (isNodeOfType(parent, "ConditionalExpression") &&
    (stripParenExpression(parent.consequent) === stripParenExpression(node) ||
      stripParenExpression(parent.alternate) === stripParenExpression(node)));

interface ContainingExpressionAnalysis {
  expressionRoot: EsTreeNode;
  isGuarded: boolean;
}

const analyzeContainingExpression = (node: EsTreeNode): ContainingExpressionAnalysis => {
  let expressionRoot = findCallResultExpression(node);
  let isGuarded = false;
  let parent = expressionRoot.parent ?? null;
  while (parent && isExpressionBranchOf(parent, expressionRoot)) {
    if (isGuardedExpressionBranchOf(parent, expressionRoot)) isGuarded = true;
    expressionRoot = findCallResultExpression(parent);
    parent = expressionRoot.parent ?? null;
  }
  return { expressionRoot, isGuarded };
};

const moduleCachesEveryReturnedResult = (
  createCall: EsTreeNode,
  programRoot: EsTreeNode,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const enclosingFunction = findEnclosingFunction(createCall);
  if (!enclosingFunction) return false;
  const returnedExpression = analyzeContainingExpression(createCall).expressionRoot;
  const isExplicitReturn = isNodeOfType(returnedExpression.parent, "ReturnStatement");
  const isConciseArrowReturn =
    isNodeOfType(enclosingFunction, "ArrowFunctionExpression") &&
    stripParenExpression(enclosingFunction.body) === stripParenExpression(returnedExpression);
  if (!isExplicitReturn && !isConciseArrowReturn) {
    return false;
  }
  const callExpressions: EsTreeNodeOfType<"CallExpression">[] = [];
  const evictedCacheSymbolIds = new Set<number>();
  const cacheStoresByRetainedSymbolId = new Map<number, EsTreeNodeOfType<"CallExpression">[]>();
  walkAst(programRoot, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    callExpressions.push(child);
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee) ?? "";
    if (!CACHE_EVICTION_METHOD_NAMES.has(methodName) && !CACHE_STORE_METHOD_NAMES.has(methodName)) {
      return;
    }
    const cacheSymbolId = getModuleScopeCacheSymbolId(callee.object, scopes);
    if (cacheSymbolId === null) return;
    if (CACHE_EVICTION_METHOD_NAMES.has(methodName)) {
      evictedCacheSymbolIds.add(cacheSymbolId);
      return;
    }
    if (!CACHE_STORE_METHOD_NAMES.has(methodName)) return;
    const retainedSymbolIds = new Set<number>();
    for (const argument of child.arguments) {
      if (isAstNode(argument)) collectRetainedSymbolIds(argument, scopes, retainedSymbolIds);
    }
    for (const retainedSymbolId of retainedSymbolIds) {
      const stores = cacheStoresByRetainedSymbolId.get(retainedSymbolId) ?? [];
      stores.push(child);
      cacheStoresByRetainedSymbolId.set(retainedSymbolId, stores);
    }
  });
  let didFindCall = false;
  let didFindUncachedCall = false;
  for (const child of callExpressions) {
    if (didFindUncachedCall) break;
    if (!isNodeOfType(stripParenExpression(child.callee), "Identifier")) continue;
    const callee = stripParenExpression(child.callee);
    if (
      !isNodeOfType(callee, "Identifier") ||
      scopes.symbolFor(callee)?.initializer !== enclosingFunction
    ) {
      continue;
    }
    didFindCall = true;
    const resultExpression = findBoundCallResult(child) ?? findCallResultExpression(child);
    let didCacheResult = false;
    const executionBoundary = context.cfg.enclosingFunction(child);
    const resultCandidate = stripParenExpression(resultExpression);
    const resultSymbol = isNodeOfType(resultCandidate, "Identifier")
      ? scopes.symbolFor(resultCandidate)
      : null;
    const candidateStores = resultSymbol
      ? (cacheStoresByRetainedSymbolId.get(resultSymbol.id) ?? [])
      : (() => {
          const ancestors: EsTreeNodeOfType<"CallExpression">[] = [];
          let ancestor = resultExpression.parent ?? null;
          while (ancestor && context.cfg.enclosingFunction(ancestor) === executionBoundary) {
            if (isNodeOfType(ancestor, "CallExpression")) ancestors.push(ancestor);
            ancestor = ancestor.parent ?? null;
          }
          return ancestors;
        })();
    for (const candidate of candidateStores) {
      if (didCacheResult) break;
      if (
        isNodeReachableWithinFunction(candidate, context) &&
        context.cfg.isUnconditionalFromEntry(candidate) &&
        context.cfg.enclosingFunction(candidate) === executionBoundary &&
        isCacheStoreOfExpression(candidate, resultExpression, scopes)
      ) {
        const candidateCallee = stripParenExpression(candidate.callee);
        if (isNodeOfType(candidateCallee, "MemberExpression")) {
          const cacheSymbolId = getModuleScopeCacheSymbolId(candidateCallee.object, scopes);
          didCacheResult = cacheSymbolId !== null && !evictedCacheSymbolIds.has(cacheSymbolId);
        }
      }
    }
    if (!didCacheResult) {
      didFindUncachedCall = true;
    }
  }
  return didFindCall && !didFindUncachedCall;
};

const isStateSetterCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "Identifier") && isSetterIdentifier(callee.name);

const SET_ATTRIBUTE_URL_NAMES = new Set(["href", "src"]);

const isUrlSetAttributeCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  urlArgument: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticPropertyName(callee) !== "setAttribute") return false;
  const [attributeName, attributeValue] = call.arguments;
  if (!attributeName || !attributeValue) return false;
  if (!isNodeOfType(attributeName, "Literal") || typeof attributeName.value !== "string") {
    return false;
  }
  if (!SET_ATTRIBUTE_URL_NAMES.has(attributeName.value)) return false;
  return stripParenExpression(attributeValue) === stripParenExpression(urlArgument);
};

const isDirectIfBranchStatement = (assignment: EsTreeNode): boolean => {
  const statement = findTransparentExpressionRoot(assignment).parent ?? null;
  if (!statement || !isNodeOfType(statement, "ExpressionStatement")) return false;
  let container = statement.parent ?? null;
  if (container && isNodeOfType(container, "BlockStatement")) container = container.parent ?? null;
  return container !== null && isNodeOfType(container, "IfStatement");
};

const isNestedInReturnedValue = (node: EsTreeNode): boolean => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) return true;
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") &&
      stripParenExpression(parent.body) === stripParenExpression(current)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "Property") && parent.value === current) {
      current = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "ObjectExpression") &&
        parent.properties.some((property) => property === current)) ||
      (isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === current)) ||
      (isNodeOfType(parent, "SpreadElement") && parent.argument === current)
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const escapeIsLeaky = (callNode: EsTreeNode): boolean => {
  const containingExpression = analyzeContainingExpression(callNode);
  const topNode = containingExpression.expressionRoot;
  const guarded = containingExpression.isGuarded;
  const parent = topNode.parent ?? null;
  if (!parent) return false;

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    stripParenExpression(parent.right) === stripParenExpression(topNode)
  ) {
    const target = parent.left;
    if (
      isNodeOfType(target, "MemberExpression") &&
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(getStaticPropertyName(target) ?? "")
    ) {
      return true;
    }
    // The guarded creation assigned to a pre-declared variable is the same
    // "object URL for fetched data" leak as the guarded VariableDeclarator.
    if (isNodeOfType(target, "Identifier")) {
      return guarded || isDirectIfBranchStatement(parent);
    }
    return false;
  }

  if (isNodeOfType(parent, "ReturnStatement")) return true;
  if (isNestedInReturnedValue(topNode)) return true;

  if (
    isNodeOfType(parent, "ArrowFunctionExpression") &&
    stripParenExpression(parent.body) === stripParenExpression(topNode)
  ) {
    return true;
  }

  if (isNodeOfType(parent, "JSXExpressionContainer") && parent.parent) {
    return isNodeOfType(parent.parent, "JSXAttribute");
  }

  // A conditional/logical creation stored in a variable is the
  // "object URL for fetched data, kept in state" leak; an unguarded
  // `const x = URL.createObjectURL(file)` is the ambiguous
  // avatar/preview case the spec keeps quiet.
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init &&
    stripParenExpression(parent.init) === stripParenExpression(topNode)
  ) {
    return guarded;
  }

  // Passed directly to a state setter (`setImageUrl(URL.createObjectURL(...))`)
  // or set as an element URL attribute (`a.setAttribute('href', ...)`).
  if (isNodeOfType(parent, "CallExpression")) {
    if (isStateSetterCallee(parent.callee)) return true;
    if (isUrlSetAttributeCall(parent, topNode)) return true;
  }

  return false;
};

// Flags `URL.createObjectURL(...)` whose produced URL escapes (assigned to
// an element `href`/`src` directly or via `setAttribute`, stored into a ref,
// returned, rendered inline in JSX, passed to a state setter, or a guarded
// value bound to a variable — declared or assigned)
// when the module never references `URL.revokeObjectURL`. The blob URL
// pins its Blob/File in memory until revoked, so an un-revoked URL leaks.
export const noCreateObjectUrlWithoutRevoke = defineRule({
  id: "no-create-object-url-without-revoke",
  title: "createObjectURL without revokeObjectURL",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Call `URL.revokeObjectURL(url)` once the object URL is no longer needed (after the download, in a `useEffect` cleanup, or on unmount). An object URL keeps its Blob/File alive for the document lifetime until it is revoked.",
  create: (context: RuleContext) => {
    let programRoot: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programRoot = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isUrlMethodCall(node, "createObjectURL", context.scopes)) return;
        if (!escapeIsLeaky(node)) return;
        if (programRoot && moduleCachesEveryReturnedResult(node, programRoot, context)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
