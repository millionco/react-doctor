import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import {
  functionReturnsMatchingExpression,
  functionReturnsMatchingExpressionOnEveryPathAfterNode,
} from "../../../utils/function-returns-matching-expression.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeConditionallyExecuted } from "../../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isR3fReactApiCall } from "./is-r3f-react-api-call.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);
const EAGER_HOOK_NAMES = new Set(["useRef", "useState"]);
const STABLE_FACTORY_HOOK_NAMES = new Set(["useMemo", "useState"]);

export interface OwnedLifecycleResourcePath {
  kind: "direct" | "array" | "object";
  index: number | null;
  propertyName: string | null;
}

interface LifecycleCleanupSource {
  callback: EsTreeNode;
  dependencyStatus: "valid" | "invalid" | "unknown";
}

interface LifecycleEffectEntry {
  callback: EsTreeNode;
  call: EsTreeNodeOfType<"CallExpression">;
  hasUnconditionalRegistration: boolean;
  ownerFunction: EsTreeNode | null;
}

interface LifecycleProgramIndex {
  effectByCallback: ReadonlyMap<EsTreeNode, LifecycleEffectEntry>;
  effectsByReferencedSymbolId: ReadonlyMap<number, ReadonlySet<LifecycleEffectEntry>>;
}

export interface OwnedLifecycleResourceAnalysis {
  accessPath: OwnedLifecycleResourcePath;
  allocation: EsTreeNode;
  creationKind: "effect" | "reactive" | "render" | "stable";
  hasEagerHookAllocation: boolean;
  hasUnstableIdentity: boolean;
  hasUnknownOwnershipTransfer: boolean;
  ownerFunction: EsTreeNode;
  resourceSymbols: ReadonlySet<SymbolDescriptor>;
  symbols: ReadonlySet<SymbolDescriptor>;
}

export interface OwnedLifecycleCleanupAnalysis {
  isProven: boolean;
  isUnknown: boolean;
}

export interface OwnedLifecycleResourceOptions {
  borrowedArgumentMethodNames?: ReadonlySet<string>;
  isBorrowedArgument?: (call: EsTreeNodeOfType<"CallExpression">, argument: EsTreeNode) => boolean;
  isBorrowedReference?: (reference: EsTreeNode) => boolean;
  retainsOwnershipInJsx?: boolean;
}

interface RefWrappedBinding {
  accessPath: OwnedLifecycleResourcePath;
  hasEagerHookAllocation: boolean;
  ownerFunction: EsTreeNode;
  symbol: SymbolDescriptor;
}

const lifecycleProgramIndexByContext = new WeakMap<
  RuleContext,
  WeakMap<EsTreeNodeOfType<"Program">, LifecycleProgramIndex>
>();
const earliestAbruptCompletionByFunction = new WeakMap<EsTreeNode, number | null>();

const getProgram = (node: EsTreeNode): EsTreeNodeOfType<"Program"> | null => {
  let current: EsTreeNode | null = node;
  while (current?.parent) current = current.parent;
  return isNodeOfType(current, "Program") ? current : null;
};

const isExecutionGuaranteed = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  if (isNodeConditionallyExecuted(node, boundary)) return false;
  let current = node;
  while (current.parent && current.parent !== boundary) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "ForStatement") ||
      isNodeOfType(parent, "ForInStatement") ||
      isNodeOfType(parent, "ForOfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "TryStatement")
    ) {
      return false;
    }
    current = parent;
  }
  const cachedEarliestAbruptCompletion = earliestAbruptCompletionByFunction.get(boundary);
  let earliestAbruptCompletion: number | null;
  if (cachedEarliestAbruptCompletion === undefined) {
    let discoveredEarliestAbruptCompletion: number | null = null;
    walkAst(boundary, (candidate) => {
      if (candidate !== boundary && isFunctionLike(candidate)) return false;
      if (
        (isNodeOfType(candidate, "ReturnStatement") || isNodeOfType(candidate, "ThrowStatement")) &&
        (discoveredEarliestAbruptCompletion === null ||
          candidate.range[0] < discoveredEarliestAbruptCompletion)
      ) {
        discoveredEarliestAbruptCompletion = candidate.range[0];
      }
    });
    earliestAbruptCompletion = discoveredEarliestAbruptCompletion;
    earliestAbruptCompletionByFunction.set(boundary, earliestAbruptCompletion);
  } else {
    earliestAbruptCompletion = cachedEarliestAbruptCompletion;
  }
  return earliestAbruptCompletion === null || earliestAbruptCompletion >= node.range[0];
};

const getLifecycleProgramIndex = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): LifecycleProgramIndex => {
  const indexByProgram =
    lifecycleProgramIndexByContext.get(context) ??
    new WeakMap<EsTreeNodeOfType<"Program">, LifecycleProgramIndex>();
  lifecycleProgramIndexByContext.set(context, indexByProgram);
  const cachedIndex = indexByProgram.get(program);
  if (cachedIndex) return cachedIndex;
  const effectByCallback = new Map<EsTreeNode, LifecycleEffectEntry>();
  const effectsByReferencedSymbolId = new Map<number, Set<LifecycleEffectEntry>>();
  walkAst(program, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isR3fReactApiCall(candidate, EFFECT_HOOK_NAMES, context.scopes)
    ) {
      return;
    }
    const callback = getEffectCallback(candidate, context.scopes);
    if (!callback) return;
    const ownerFunction = findRenderPhaseComponentOrHook(candidate, context.scopes);
    const entry: LifecycleEffectEntry = {
      callback,
      call: candidate,
      hasUnconditionalRegistration: Boolean(
        ownerFunction && isExecutionGuaranteed(candidate, ownerFunction),
      ),
      ownerFunction,
    };
    if (!effectByCallback.has(callback)) effectByCallback.set(callback, entry);
    const visitedFunctions = new Set<EsTreeNode>();
    const collectReferencedSymbols = (root: EsTreeNode): void => {
      if (isFunctionLike(root)) {
        if (visitedFunctions.has(root)) return;
        visitedFunctions.add(root);
      }
      walkAst(root, (referenceCandidate) => {
        if (isNodeOfType(referenceCandidate, "Identifier")) {
          const symbol = context.scopes.symbolFor(referenceCandidate);
          if (symbol) {
            const entries = effectsByReferencedSymbolId.get(symbol.id) ?? new Set();
            entries.add(entry);
            effectsByReferencedSymbolId.set(symbol.id, entries);
          }
          const referencedFunction = resolveExactLocalFunction(referenceCandidate, context.scopes);
          if (referencedFunction) collectReferencedSymbols(referencedFunction);
        }
      });
    };
    collectReferencedSymbols(candidate);
  });
  const index = { effectByCallback, effectsByReferencedSymbolId };
  indexByProgram.set(program, index);
  return index;
};

const getDirectBindingSymbol = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const parent = expressionRoot.parent;
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== expressionRoot ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return null;
  }
  return scopes.symbolFor(parent.id);
};

const expressionMatchesSymbol = (
  expression: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  return isNodeOfType(candidate, "Identifier") && scopes.symbolFor(candidate)?.id === symbol.id;
};

const collectReturnedExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode) || !functionNode.body) return [];
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return [functionNode.body];
  const returnedExpressions: EsTreeNode[] = [];
  walkAst(functionNode.body, (candidate) => {
    if (candidate !== functionNode.body && isFunctionLike(candidate)) return false;
    if (isNodeOfType(candidate, "ReturnStatement") && candidate.argument) {
      returnedExpressions.push(candidate.argument);
    }
  });
  return returnedExpressions;
};

const getReturnedBindingPath = (
  returnedExpression: EsTreeNode,
  allocation: EsTreeNode,
  localSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): OwnedLifecycleResourcePath | null => {
  const candidate = stripParenExpression(returnedExpression);
  const matchesAllocation = (expression: EsTreeNode): boolean =>
    stripParenExpression(expression) === allocation ||
    Boolean(localSymbol && expressionMatchesSymbol(expression, localSymbol, scopes));
  if (matchesAllocation(candidate)) {
    return { kind: "direct", index: null, propertyName: null };
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    const matchingIndexes = candidate.elements.flatMap((element, index) =>
      element && !isNodeOfType(element, "SpreadElement") && matchesAllocation(element)
        ? [index]
        : [],
    );
    return matchingIndexes.length === 1
      ? { kind: "array", index: matchingIndexes[0] ?? null, propertyName: null }
      : null;
  }
  if (isNodeOfType(candidate, "ObjectExpression")) {
    const matchingProperties = candidate.properties.flatMap((property) => {
      if (!isNodeOfType(property, "Property") || !matchesAllocation(property.value)) return [];
      const propertyName = getStaticPropertyKeyName(property);
      return propertyName ? [propertyName] : [];
    });
    return matchingProperties.length === 1
      ? { kind: "object", index: null, propertyName: matchingProperties[0] ?? null }
      : null;
  }
  return null;
};

const haveSameReturnedBindingPath = (
  left: OwnedLifecycleResourcePath,
  right: OwnedLifecycleResourcePath,
): boolean =>
  left.kind === right.kind &&
  left.index === right.index &&
  left.propertyName === right.propertyName;

const getPatternBinding = (
  pattern: EsTreeNode,
  path: OwnedLifecycleResourcePath,
  isStateFactory: boolean,
): EsTreeNode | null => {
  if (isStateFactory) {
    return isNodeOfType(pattern, "ArrayPattern") && pattern.elements[0]
      ? pattern.elements[0]
      : null;
  }
  if (path.kind === "direct") return isNodeOfType(pattern, "Identifier") ? pattern : null;
  if (path.kind === "array" && isNodeOfType(pattern, "ArrayPattern") && path.index !== null) {
    const element = pattern.elements[path.index];
    return element && isNodeOfType(element, "Identifier") ? element : null;
  }
  if (path.kind === "object" && isNodeOfType(pattern, "ObjectPattern") && path.propertyName) {
    for (const property of pattern.properties) {
      if (
        isNodeOfType(property, "Property") &&
        getStaticPropertyKeyName(property) === path.propertyName &&
        isNodeOfType(property.value, "Identifier")
      ) {
        return property.value;
      }
    }
  }
  return null;
};

const getWrappedBinding = (
  allocation: EsTreeNode,
  scopes: ScopeAnalysis,
): {
  accessPath: OwnedLifecycleResourcePath;
  creationKind: "reactive" | "stable";
  ownerFunction: EsTreeNode;
  symbol: SymbolDescriptor;
} | null => {
  const callback = findEnclosingFunction(allocation);
  if (!callback || isNodeConditionallyExecuted(allocation, callback)) return null;
  const wrapperCall = callback.parent;
  if (
    !isNodeOfType(wrapperCall, "CallExpression") ||
    wrapperCall.arguments[0] !== callback ||
    !isR3fReactApiCall(wrapperCall, STABLE_FACTORY_HOOK_NAMES, scopes)
  ) {
    return null;
  }
  const wrapperRoot = findTransparentExpressionRoot(wrapperCall);
  const declaration = wrapperRoot.parent;
  if (!isNodeOfType(declaration, "VariableDeclarator") || declaration.init !== wrapperRoot) {
    return null;
  }
  const localSymbol = getDirectBindingSymbol(allocation, scopes);
  const returnedExpressions = collectReturnedExpressions(callback);
  const returnedPaths = returnedExpressions.map((returnedExpression) =>
    getReturnedBindingPath(returnedExpression, allocation, localSymbol, scopes),
  );
  const firstPath = returnedPaths[0];
  if (
    !firstPath ||
    returnedPaths.some(
      (returnedPath) => !returnedPath || !haveSameReturnedBindingPath(returnedPath, firstPath),
    )
  ) {
    return null;
  }
  const isStateFactory = isR3fReactApiCall(wrapperCall, "useState", scopes);
  const binding = getPatternBinding(declaration.id, firstPath, isStateFactory);
  if (!binding || !isNodeOfType(binding, "Identifier")) return null;
  const symbol = scopes.symbolFor(binding);
  const ownerFunction = findRenderPhaseComponentOrHook(wrapperCall, scopes);
  if (!symbol || !ownerFunction || findEnclosingFunction(binding) !== ownerFunction) return null;
  const dependencies = wrapperCall.arguments[1];
  const isStableMemo =
    isNodeOfType(dependencies, "ArrayExpression") && dependencies.elements.length === 0;
  return {
    accessPath: isStateFactory ? firstPath : { kind: "direct", index: null, propertyName: null },
    creationKind: isStateFactory || isStableMemo ? "stable" : "reactive",
    ownerFunction,
    symbol,
  };
};

const expressionMatchesRefCurrent = (
  expression: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(candidate.object);
  return isNodeOfType(receiver, "Identifier") && scopes.symbolFor(receiver)?.id === refSymbol.id;
};

const getUseRefBinding = (
  useRefCall: EsTreeNode,
  scopes: ScopeAnalysis,
): { ownerFunction: EsTreeNode; symbol: SymbolDescriptor } | null => {
  const callRoot = findTransparentExpressionRoot(useRefCall);
  const declaration = callRoot.parent;
  if (
    !isNodeOfType(useRefCall, "CallExpression") ||
    !isR3fReactApiCall(useRefCall, "useRef", scopes) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== callRoot ||
    !isNodeOfType(declaration.id, "Identifier")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(declaration.id);
  const ownerFunction = findRenderPhaseComponentOrHook(useRefCall, scopes);
  return symbol && ownerFunction && findEnclosingFunction(declaration.id) === ownerFunction
    ? { ownerFunction, symbol }
    : null;
};

const isGuardedLazyRefAssignment = (
  assignment: EsTreeNode,
  refSymbol: SymbolDescriptor,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const isNullishExpression = (expression: EsTreeNode): boolean => {
    const candidate = stripParenExpression(expression);
    if (isNodeOfType(candidate, "Literal") && candidate.value === null) return true;
    return (
      isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      !scopes.symbolFor(candidate)
    );
  };
  const testProvesEmptyRef = (expression: EsTreeNode): boolean => {
    const candidate = stripParenExpression(expression);
    if (
      isNodeOfType(candidate, "UnaryExpression") &&
      candidate.operator === "!" &&
      expressionMatchesRefCurrent(candidate.argument, refSymbol, scopes)
    ) {
      return true;
    }
    if (
      !isNodeOfType(candidate, "BinaryExpression") ||
      !["==", "==="].includes(candidate.operator)
    ) {
      return false;
    }
    return (
      (expressionMatchesRefCurrent(candidate.left, refSymbol, scopes) &&
        isNullishExpression(candidate.right)) ||
      (isNullishExpression(candidate.left) &&
        expressionMatchesRefCurrent(candidate.right, refSymbol, scopes))
    );
  };
  let current = assignment;
  while (current.parent && current.parent !== ownerFunction) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "IfStatement") &&
      parent.consequent === current &&
      testProvesEmptyRef(parent.test)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const getEagerHookOwner = (allocation: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  let current = allocation;
  while (current.parent && !isFunctionLike(current.parent)) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments[0] === current &&
      isR3fReactApiCall(parent, EAGER_HOOK_NAMES, scopes)
    ) {
      return findRenderPhaseComponentOrHook(parent, scopes);
    }
    current = parent;
  }
  return null;
};

const getRefWrappedBinding = (
  allocation: EsTreeNode,
  scopes: ScopeAnalysis,
): RefWrappedBinding | null => {
  const allocationRoot = findTransparentExpressionRoot(allocation);
  const parent = allocationRoot.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === allocationRoot &&
    isR3fReactApiCall(parent, "useRef", scopes)
  ) {
    const binding = getUseRefBinding(parent, scopes);
    return binding
      ? {
          accessPath: { kind: "object", index: null, propertyName: "current" },
          hasEagerHookAllocation: true,
          ...binding,
        }
      : null;
  }
  if (
    !isNodeOfType(parent, "AssignmentExpression") ||
    parent.operator !== "=" ||
    parent.right !== allocationRoot ||
    !isNodeOfType(parent.left, "MemberExpression") ||
    getStaticPropertyName(parent.left) !== "current"
  ) {
    return null;
  }
  const refReceiver = stripParenExpression(parent.left.object);
  if (!isNodeOfType(refReceiver, "Identifier")) return null;
  const refSymbol = scopes.symbolFor(refReceiver);
  const refInitializer = refSymbol?.initializer
    ? stripParenExpression(refSymbol.initializer)
    : null;
  if (
    !refSymbol ||
    refSymbol.kind !== "const" ||
    !refInitializer ||
    !isNodeOfType(refInitializer, "CallExpression") ||
    !isR3fReactApiCall(refInitializer, "useRef", scopes)
  ) {
    return null;
  }
  const binding = getUseRefBinding(refInitializer, scopes);
  if (
    !binding ||
    binding.symbol.id !== refSymbol.id ||
    findEnclosingFunction(parent) !== binding.ownerFunction ||
    !isGuardedLazyRefAssignment(parent, refSymbol, binding.ownerFunction, scopes)
  ) {
    return null;
  }
  return {
    accessPath: { kind: "object", index: null, propertyName: "current" },
    hasEagerHookAllocation: false,
    ownerFunction: binding.ownerFunction,
    symbol: refSymbol,
  };
};

const getEagerStateWrappedBinding = (
  allocation: EsTreeNode,
  scopes: ScopeAnalysis,
): RefWrappedBinding | null => {
  const allocationRoot = findTransparentExpressionRoot(allocation);
  const stateCall = allocationRoot.parent;
  if (
    !isNodeOfType(stateCall, "CallExpression") ||
    stateCall.arguments[0] !== allocationRoot ||
    !isR3fReactApiCall(stateCall, "useState", scopes)
  ) {
    return null;
  }
  const callRoot = findTransparentExpressionRoot(stateCall);
  const declaration = callRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== callRoot ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !declaration.id.elements[0] ||
    !isNodeOfType(declaration.id.elements[0], "Identifier")
  ) {
    return null;
  }
  const bindingIdentifier = declaration.id.elements[0];
  const symbol = scopes.symbolFor(bindingIdentifier);
  const ownerFunction = findRenderPhaseComponentOrHook(stateCall, scopes);
  return symbol && ownerFunction && findEnclosingFunction(bindingIdentifier) === ownerFunction
    ? {
        accessPath: { kind: "direct", index: null, propertyName: null },
        hasEagerHookAllocation: true,
        ownerFunction,
        symbol,
      }
    : null;
};

const collectAliasSymbols = (
  sourceSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): Set<SymbolDescriptor> => {
  const symbols = new Set<SymbolDescriptor>([sourceSymbol]);
  const pendingSymbols = [sourceSymbol];
  while (pendingSymbols.length > 0) {
    const currentSymbol = pendingSymbols.pop();
    if (!currentSymbol) break;
    for (const reference of currentSymbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const declaration = referenceRoot.parent;
      if (
        !isNodeOfType(declaration, "VariableDeclarator") ||
        declaration.init !== referenceRoot ||
        !isNodeOfType(declaration.id, "Identifier")
      ) {
        continue;
      }
      const aliasSymbol = scopes.symbolFor(declaration.id);
      if (
        aliasSymbol?.kind === "const" &&
        aliasSymbol.references.every((aliasReference) => aliasReference.flag === "read") &&
        !symbols.has(aliasSymbol)
      ) {
        symbols.add(aliasSymbol);
        pendingSymbols.push(aliasSymbol);
      }
    }
  }
  return symbols;
};

const collectStructuredResourceSymbols = (
  ownerSymbols: ReadonlySet<SymbolDescriptor>,
  accessPath: OwnedLifecycleResourcePath,
  scopes: ScopeAnalysis,
): Set<SymbolDescriptor> => {
  const resourceSymbols = new Set<SymbolDescriptor>();
  if (accessPath.kind === "direct") {
    for (const symbol of ownerSymbols) resourceSymbols.add(symbol);
    return resourceSymbols;
  }
  for (const symbol of ownerSymbols) {
    for (const reference of symbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const member = referenceRoot.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== referenceRoot ||
        (accessPath.kind === "object"
          ? getStaticPropertyName(member) !== accessPath.propertyName
          : !(
              member.computed &&
              isNodeOfType(member.property, "Literal") &&
              member.property.value === accessPath.index
            ))
      ) {
        continue;
      }
      const memberRoot = findTransparentExpressionRoot(member);
      const declaration = memberRoot.parent;
      if (
        !isNodeOfType(declaration, "VariableDeclarator") ||
        declaration.init !== memberRoot ||
        !isNodeOfType(declaration.id, "Identifier")
      ) {
        continue;
      }
      const aliasSymbol = scopes.symbolFor(declaration.id);
      if (!aliasSymbol) continue;
      for (const resourceSymbol of collectAliasSymbols(aliasSymbol, scopes)) {
        resourceSymbols.add(resourceSymbol);
      }
    }
  }
  return resourceSymbols;
};

const expressionMatchesOwnedResource = (
  expression: EsTreeNode,
  symbols: ReadonlySet<SymbolDescriptor>,
  resourceSymbols: ReadonlySet<SymbolDescriptor>,
  accessPath: OwnedLifecycleResourcePath,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (symbol && resourceSymbols.has(symbol)) {
      return true;
    }
  }
  if (accessPath.kind === "direct") {
    return false;
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  const receiver = stripParenExpression(candidate.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol || !symbols.has(symbol)) return false;
  if (accessPath.kind === "object") {
    return getStaticPropertyName(candidate) === accessPath.propertyName;
  }
  return Boolean(
    candidate.computed &&
    isNodeOfType(candidate.property, "Literal") &&
    candidate.property.value === accessPath.index,
  );
};

const expressionMatchesOwnedResourceOwner = (
  expression: EsTreeNode,
  analysis: OwnedLifecycleResourceAnalysis,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    expressionMatchesOwnedResource(
      expression,
      analysis.symbols,
      analysis.resourceSymbols,
      analysis.accessPath,
      scopes,
    )
  ) {
    return true;
  }
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  return Boolean(symbol && analysis.symbols.has(symbol));
};

export const expressionMatchesOwnedLifecycleResource = (
  expression: EsTreeNode,
  analysis: OwnedLifecycleResourceAnalysis,
  scopes: ScopeAnalysis,
): boolean =>
  expressionMatchesOwnedResource(
    expression,
    analysis.symbols,
    analysis.resourceSymbols,
    analysis.accessPath,
    scopes,
  );

const getOwnedResourceAccessFromReference = (
  reference: EsTreeNode,
  symbols: ReadonlySet<SymbolDescriptor>,
  resourceSymbols: ReadonlySet<SymbolDescriptor>,
  accessPath: OwnedLifecycleResourcePath,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const referenceRoot = findTransparentExpressionRoot(reference);
  if (expressionMatchesOwnedResource(referenceRoot, symbols, resourceSymbols, accessPath, scopes)) {
    return referenceRoot;
  }
  if (accessPath.kind === "direct") {
    return null;
  }
  const member = referenceRoot.parent;
  return isNodeOfType(member, "MemberExpression") &&
    member.object === referenceRoot &&
    expressionMatchesOwnedResource(member, symbols, resourceSymbols, accessPath, scopes)
    ? member
    : null;
};

const hasOwnedResourceIdentityWrite = (
  allocation: EsTreeNode,
  symbols: ReadonlySet<SymbolDescriptor>,
  resourceSymbols: ReadonlySet<SymbolDescriptor>,
  accessPath: OwnedLifecycleResourcePath,
  scopes: ScopeAnalysis,
): boolean => {
  const getContainingIdentityWrite = (resourceAccess: EsTreeNode): EsTreeNode | null => {
    let current = findTransparentExpressionRoot(resourceAccess);
    while (current.parent && !isFunctionLike(current.parent)) {
      const parent = current.parent;
      if (isNodeOfType(parent, "AssignmentExpression")) {
        return parent.left === current ? parent : null;
      }
      if (isNodeOfType(parent, "UpdateExpression")) {
        return parent.argument === current ? parent : null;
      }
      if (
        !isNodeOfType(parent, "ArrayPattern") &&
        !isNodeOfType(parent, "ObjectPattern") &&
        !isNodeOfType(parent, "Property") &&
        !isNodeOfType(parent, "RestElement")
      ) {
        return null;
      }
      current = parent;
    }
    return null;
  };
  const allSymbols = new Set([...symbols, ...resourceSymbols]);
  for (const symbol of allSymbols) {
    for (const reference of symbol.references) {
      const resourceAccess = getOwnedResourceAccessFromReference(
        reference.identifier,
        symbols,
        resourceSymbols,
        accessPath,
        scopes,
      );
      if (!resourceAccess) continue;
      const containingWrite = getContainingIdentityWrite(resourceAccess);
      if (
        containingWrite &&
        (!isNodeOfType(containingWrite, "AssignmentExpression") ||
          findTransparentExpressionRoot(containingWrite.right) !==
            findTransparentExpressionRoot(allocation))
      ) {
        return true;
      }
    }
  }
  return false;
};

const findContainingCallArgument = (
  reference: EsTreeNode,
): { call: EsTreeNodeOfType<"CallExpression">; argument: EsTreeNode } | null => {
  let current = reference;
  while (current.parent) {
    const parent = current.parent;
    if (isFunctionLike(parent)) return null;
    if (isNodeOfType(parent, "CallExpression")) {
      return parent.arguments.some((argument) => argument === current)
        ? { call: parent, argument: current }
        : null;
    }
    current = parent;
  }
  return null;
};

const isEffectDependencyReference = (reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callArgument = findContainingCallArgument(reference);
  return Boolean(
    callArgument &&
    callArgument.call.arguments[1] === callArgument.argument &&
    isR3fReactApiCall(callArgument.call, EFFECT_HOOK_NAMES, scopes),
  );
};

const isReturnedFromOwner = (reference: EsTreeNode, ownerFunction: EsTreeNode): boolean => {
  if (findEnclosingFunction(reference) !== ownerFunction) return false;
  let current = reference;
  while (current.parent && current.parent !== ownerFunction) {
    if (isNodeOfType(current.parent, "ReturnStatement")) return true;
    current = current.parent;
  }
  return false;
};

const isInsideJsxExpression = (reference: EsTreeNode): boolean => {
  let current: EsTreeNode | null = reference;
  while (current?.parent && !isFunctionLike(current.parent)) {
    if (isNodeOfType(current.parent, "JSXExpressionContainer")) return true;
    current = current.parent;
  }
  return false;
};

const crossesCustomJsxOwnershipBoundary = (reference: EsTreeNode): boolean => {
  const referenceRoot = findTransparentExpressionRoot(reference);
  if (
    isNodeOfType(referenceRoot.parent, "MemberExpression") &&
    referenceRoot.parent.object === referenceRoot
  ) {
    return false;
  }
  let current: EsTreeNode | null = reference;
  while (current?.parent && !isFunctionLike(current.parent)) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "JSXAttribute")) {
      const openingElement = parent.parent;
      if (!isNodeOfType(openingElement, "JSXOpeningElement")) return true;
      if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return true;
      const elementName = openingElement.name.name;
      return elementName.includes("-") || elementName[0] !== elementName[0]?.toLowerCase();
    }
    current = parent;
  }
  return false;
};

const isNestedInJsxOwnedMemoValue = (
  reference: EsTreeNode,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callback = findEnclosingFunction(reference);
  if (!callback || callback === ownerFunction) return false;
  const memoCall = callback.parent;
  if (
    !isNodeOfType(memoCall, "CallExpression") ||
    memoCall.arguments[0] !== callback ||
    !isR3fReactApiCall(memoCall, "useMemo", scopes) ||
    findRenderPhaseComponentOrHook(memoCall, scopes) !== ownerFunction
  ) {
    return false;
  }
  const memoRoot = findTransparentExpressionRoot(memoCall);
  const declaration = memoRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== memoRoot ||
    !isNodeOfType(declaration.id, "Identifier")
  ) {
    return false;
  }
  const memoSymbol = scopes.symbolFor(declaration.id);
  return Boolean(
    memoSymbol &&
    memoSymbol.references.length > 0 &&
    memoSymbol.references.every(
      (memoReference) =>
        isInsideJsxExpression(memoReference.identifier) &&
        !crossesCustomJsxOwnershipBoundary(memoReference.identifier),
    ),
  );
};

const hasUnknownOwnershipTransfer = (
  symbols: ReadonlySet<SymbolDescriptor>,
  resourceSymbols: ReadonlySet<SymbolDescriptor>,
  accessPath: OwnedLifecycleResourcePath,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  borrowedArgumentMethodNames: ReadonlySet<string>,
  retainsOwnershipInJsx: boolean,
  isBorrowedArgument: (call: EsTreeNodeOfType<"CallExpression">, argument: EsTreeNode) => boolean,
  isBorrowedReference: (reference: EsTreeNode) => boolean,
): boolean => {
  const allSymbols = new Set([...symbols, ...resourceSymbols]);
  for (const symbol of allSymbols) {
    for (const reference of symbol.references) {
      const referenceNode = getOwnedResourceAccessFromReference(
        reference.identifier,
        symbols,
        resourceSymbols,
        accessPath,
        scopes,
      );
      if (!referenceNode) {
        if (accessPath.kind === "direct" || !symbols.has(symbol)) continue;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const parent = referenceRoot.parent;
        if (
          (isNodeOfType(parent, "VariableDeclarator") && parent.init === referenceRoot) ||
          isEffectDependencyReference(reference.identifier, scopes) ||
          (isNodeOfType(parent, "MemberExpression") &&
            parent.object === referenceRoot &&
            getStaticPropertyName(parent) !== null)
        ) {
          continue;
        }
        return true;
      }
      const referenceRoot = findTransparentExpressionRoot(referenceNode);
      const parent = referenceRoot.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        continue;
      }
      if (isEffectDependencyReference(referenceNode, scopes)) continue;
      if (isBorrowedReference(referenceNode)) continue;
      if (retainsOwnershipInJsx && crossesCustomJsxOwnershipBoundary(referenceNode)) return true;
      const isResourceMemberAccess =
        isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot;
      if (
        isReturnedFromOwner(referenceNode, ownerFunction) &&
        !isResourceMemberAccess &&
        !(retainsOwnershipInJsx && isInsideJsxExpression(referenceNode))
      ) {
        return true;
      }
      const callArgument = findContainingCallArgument(referenceNode);
      if (callArgument) {
        if (stripParenExpression(callArgument.argument) !== stripParenExpression(referenceNode)) {
          continue;
        }
        const callee = stripParenExpression(callArgument.call.callee);
        const methodName = isNodeOfType(callee, "MemberExpression")
          ? getStaticPropertyName(callee)
          : null;
        if (
          (!methodName || !borrowedArgumentMethodNames.has(methodName)) &&
          !isBorrowedArgument(callArgument.call, callArgument.argument)
        ) {
          return true;
        }
        continue;
      }
      if (isResourceMemberAccess) {
        continue;
      }
      let current: EsTreeNode = referenceNode;
      while (current.parent && !isFunctionLike(current.parent)) {
        const currentParent = current.parent;
        if (
          (isNodeOfType(currentParent, "JSXExpressionContainer") && !retainsOwnershipInJsx) ||
          (isNodeOfType(currentParent, "AssignmentExpression") &&
            currentParent.right === current) ||
          (isNodeOfType(currentParent, "Property") && currentParent.value === current) ||
          isNodeOfType(currentParent, "ArrayExpression")
        ) {
          if (
            retainsOwnershipInJsx &&
            (isNodeOfType(currentParent, "Property") ||
              isNodeOfType(currentParent, "ArrayExpression")) &&
            isNestedInJsxOwnedMemoValue(referenceNode, ownerFunction, scopes)
          ) {
            break;
          }
          return true;
        }
        current = currentParent;
      }
    }
  }
  return false;
};

export const analyzeOwnedLifecycleResource = (
  allocation: EsTreeNode,
  context: RuleContext,
  options: OwnedLifecycleResourceOptions = {},
): OwnedLifecycleResourceAnalysis | null => {
  const {
    borrowedArgumentMethodNames = new Set(),
    isBorrowedArgument = () => false,
    isBorrowedReference = () => false,
    retainsOwnershipInJsx = false,
  } = options;
  const program = getProgram(allocation);
  if (!program) return null;
  const refWrappedBinding = getRefWrappedBinding(allocation, context.scopes);
  const eagerStateWrappedBinding = getEagerStateWrappedBinding(allocation, context.scopes);
  const wrappedBinding = getWrappedBinding(allocation, context.scopes);
  const eagerHookOwner = getEagerHookOwner(allocation, context.scopes);
  let accessPath: OwnedLifecycleResourcePath;
  let creationKind: OwnedLifecycleResourceAnalysis["creationKind"];
  let ownerFunction: EsTreeNode | null;
  let sourceSymbol: SymbolDescriptor | null;
  let hasEagerHookAllocation = false;
  if (refWrappedBinding) {
    accessPath = refWrappedBinding.accessPath;
    creationKind = "stable";
    ownerFunction = refWrappedBinding.ownerFunction;
    sourceSymbol = refWrappedBinding.symbol;
    hasEagerHookAllocation = refWrappedBinding.hasEagerHookAllocation;
  } else if (eagerStateWrappedBinding) {
    accessPath = eagerStateWrappedBinding.accessPath;
    creationKind = "stable";
    ownerFunction = eagerStateWrappedBinding.ownerFunction;
    sourceSymbol = eagerStateWrappedBinding.symbol;
    hasEagerHookAllocation = true;
  } else if (wrappedBinding) {
    accessPath = wrappedBinding.accessPath;
    creationKind = wrappedBinding.creationKind;
    ownerFunction = wrappedBinding.ownerFunction;
    sourceSymbol = wrappedBinding.symbol;
  } else if (eagerHookOwner) {
    accessPath = { kind: "direct", index: null, propertyName: null };
    creationKind = "stable";
    ownerFunction = eagerHookOwner;
    sourceSymbol = getDirectBindingSymbol(allocation, context.scopes);
    hasEagerHookAllocation = true;
  } else {
    accessPath = { kind: "direct", index: null, propertyName: null };
    sourceSymbol = getDirectBindingSymbol(allocation, context.scopes);
    if (!sourceSymbol) return null;
    const allocationFunction = findEnclosingFunction(allocation);
    if (!allocationFunction || isNodeConditionallyExecuted(allocation, allocationFunction)) {
      return null;
    }
    const effectEntry = getLifecycleProgramIndex(program, context).effectByCallback.get(
      allocationFunction,
    );
    if (effectEntry) {
      ownerFunction = effectEntry.ownerFunction;
      creationKind = "effect";
    } else {
      ownerFunction = findRenderPhaseComponentOrHook(allocation, context.scopes);
      creationKind = "render";
      if (
        ownerFunction &&
        findEnclosingFunction(sourceSymbol.bindingIdentifier) !== ownerFunction
      ) {
        return null;
      }
    }
  }
  if (!ownerFunction || sourceSymbol?.scope.kind === "module") return null;
  const symbols = sourceSymbol
    ? collectAliasSymbols(sourceSymbol, context.scopes)
    : new Set<SymbolDescriptor>();
  const resourceSymbols = collectStructuredResourceSymbols(symbols, accessPath, context.scopes);
  const hasUnstableIdentity = hasOwnedResourceIdentityWrite(
    allocation,
    symbols,
    resourceSymbols,
    accessPath,
    context.scopes,
  );
  return {
    accessPath,
    allocation,
    creationKind,
    hasEagerHookAllocation,
    hasUnstableIdentity,
    hasUnknownOwnershipTransfer:
      !hasEagerHookAllocation &&
      !hasUnstableIdentity &&
      hasUnknownOwnershipTransfer(
        symbols,
        resourceSymbols,
        accessPath,
        ownerFunction,
        context.scopes,
        borrowedArgumentMethodNames,
        retainsOwnershipInJsx,
        isBorrowedArgument,
        isBorrowedReference,
      ),
    ownerFunction,
    resourceSymbols,
    symbols,
  };
};

const getDependencyStatus = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
  analysis: OwnedLifecycleResourceAnalysis,
  scopes: ScopeAnalysis,
): LifecycleCleanupSource["dependencyStatus"] => {
  const dependencies = effectCall.arguments[1];
  if (!dependencies) return "valid";
  if (isNodeOfType(dependencies, "SpreadElement")) return "unknown";
  const dependencyList = stripParenExpression(dependencies);
  if (!isNodeOfType(dependencyList, "ArrayExpression")) return "unknown";
  if (analysis.creationKind === "stable" || analysis.creationKind === "effect") return "valid";
  return dependencyList.elements.some(
    (element) =>
      element &&
      !isNodeOfType(element, "SpreadElement") &&
      expressionMatchesOwnedResourceOwner(element, analysis, scopes),
  )
    ? "valid"
    : "invalid";
};

const collectLifecycleCleanupSources = (
  analysis: OwnedLifecycleResourceAnalysis,
  context: RuleContext,
): LifecycleCleanupSource[] => {
  const program = getProgram(analysis.allocation);
  if (!program) return [];
  const sources: LifecycleCleanupSource[] = [];
  const index = getLifecycleProgramIndex(program, context);
  const candidateEffects = new Set<LifecycleEffectEntry>();
  if (analysis.creationKind === "effect") {
    const allocationFunction = findEnclosingFunction(analysis.allocation);
    const effect = allocationFunction ? index.effectByCallback.get(allocationFunction) : undefined;
    if (effect) candidateEffects.add(effect);
  } else {
    for (const symbol of [...analysis.symbols, ...analysis.resourceSymbols]) {
      for (const effect of index.effectsByReferencedSymbolId.get(symbol.id) ?? []) {
        candidateEffects.add(effect);
      }
    }
  }
  for (const entry of candidateEffects) {
    if (!entry.hasUnconditionalRegistration || entry.ownerFunction !== analysis.ownerFunction) {
      continue;
    }
    sources.push({
      callback: entry.callback,
      dependencyStatus: getDependencyStatus(entry.call, analysis, context.scopes),
    });
  }
  return sources;
};

export const analyzeOwnedLifecycleCleanup = (
  analysis: OwnedLifecycleResourceAnalysis,
  context: RuleContext,
  matchesCleanupFunction: (cleanupFunction: EsTreeNode) => boolean,
): OwnedLifecycleCleanupAnalysis => {
  if (analysis.hasEagerHookAllocation || analysis.hasUnstableIdentity) {
    return { isProven: false, isUnknown: false };
  }
  const returnedExpressionContainsMatchingCleanup = (returnedExpression: EsTreeNode): boolean => {
    const cleanupFunction = resolveExactLocalFunction(returnedExpression, context.scopes);
    return Boolean(cleanupFunction && matchesCleanupFunction(cleanupFunction));
  };
  let isUnknown = false;
  for (const source of collectLifecycleCleanupSources(analysis, context)) {
    const doesReturnMatchingCleanup =
      analysis.creationKind === "effect" &&
      findEnclosingFunction(analysis.allocation) === source.callback
        ? functionReturnsMatchingExpressionOnEveryPathAfterNode(
            source.callback,
            analysis.allocation,
            context.scopes,
            returnedExpressionContainsMatchingCleanup,
            context.cfg,
          )
        : functionReturnsMatchingExpression(
            source.callback,
            context.scopes,
            returnedExpressionContainsMatchingCleanup,
            context.cfg,
            "every",
          );
    if (!doesReturnMatchingCleanup) continue;
    if (source.dependencyStatus === "valid") return { isProven: true, isUnknown: false };
    if (source.dependencyStatus === "unknown") isUnknown = true;
  }
  return { isProven: false, isUnknown };
};

export const analyzeOwnedLifecycleSetupCleanup = (
  analysis: OwnedLifecycleResourceAnalysis,
  context: RuleContext,
  setupMethodName: string,
  matchesCleanupFunction: (cleanupFunction: EsTreeNode) => boolean,
): OwnedLifecycleCleanupAnalysis => {
  if (analysis.hasEagerHookAllocation || analysis.hasUnstableIdentity) {
    return { isProven: false, isUnknown: false };
  }
  const returnedExpressionContainsMatchingCleanup = (returnedExpression: EsTreeNode): boolean => {
    const cleanupFunction = resolveExactLocalFunction(returnedExpression, context.scopes);
    return Boolean(cleanupFunction && matchesCleanupFunction(cleanupFunction));
  };
  let isUnknown = false;
  for (const source of collectLifecycleCleanupSources(analysis, context)) {
    const setupCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    walkFunctionExecution(source.callback, context.scopes, (candidate) => {
      if (
        !isNodeOfType(candidate, "CallExpression") ||
        !isNodeOfType(candidate.callee, "MemberExpression") ||
        getStaticPropertyName(candidate.callee) !== setupMethodName ||
        !expressionMatchesOwnedResource(
          candidate.callee.object,
          analysis.symbols,
          analysis.resourceSymbols,
          analysis.accessPath,
          context.scopes,
        )
      ) {
        return;
      }
      setupCalls.push(candidate);
    });
    if (
      setupCalls.length === 0 ||
      !setupCalls.every((setupCall) =>
        functionReturnsMatchingExpressionOnEveryPathAfterNode(
          source.callback,
          setupCall,
          context.scopes,
          returnedExpressionContainsMatchingCleanup,
          context.cfg,
        ),
      )
    ) {
      continue;
    }
    if (source.dependencyStatus === "valid") return { isProven: true, isUnknown: false };
    if (source.dependencyStatus === "unknown") isUnknown = true;
  }
  return { isProven: false, isUnknown };
};

export const functionInvokesOwnedResourceMethod = (
  functionNode: EsTreeNode,
  analysis: OwnedLifecycleResourceAnalysis,
  methodName: string,
  scopes: ScopeAnalysis,
  matchesCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean = () => true,
): boolean => {
  let didInvokeMethod = false;
  walkFunctionExecution(functionNode, scopes, (candidate, isConditionallyExecuted) => {
    const enclosingFunction = findEnclosingFunction(candidate);
    if (
      didInvokeMethod ||
      isConditionallyExecuted ||
      !enclosingFunction ||
      !isExecutionGuaranteed(candidate, enclosingFunction) ||
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      getStaticPropertyName(candidate.callee) !== methodName ||
      !expressionMatchesOwnedResource(
        candidate.callee.object,
        analysis.symbols,
        analysis.resourceSymbols,
        analysis.accessPath,
        scopes,
      ) ||
      !matchesCall(candidate)
    ) {
      return;
    }
    didInvokeMethod = true;
  });
  return didInvokeMethod;
};

export const ownedResourceHasMethodCall = (
  analysis: OwnedLifecycleResourceAnalysis,
  methodName: string,
  scopes: ScopeAnalysis,
  matchesCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean = () => true,
): boolean => {
  const allSymbols = new Set([...analysis.symbols, ...analysis.resourceSymbols]);
  for (const symbol of allSymbols) {
    for (const reference of symbol.references) {
      const resourceAccess = getOwnedResourceAccessFromReference(
        reference.identifier,
        analysis.symbols,
        analysis.resourceSymbols,
        analysis.accessPath,
        scopes,
      );
      if (!resourceAccess) continue;
      const receiver = stripParenExpression(resourceAccess);
      const member = findTransparentExpressionRoot(receiver).parent;
      const call = member?.parent;
      if (
        isNodeOfType(member, "MemberExpression") &&
        member.object === findTransparentExpressionRoot(receiver) &&
        getStaticPropertyName(member) === methodName &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === member &&
        matchesCall(call)
      ) {
        return true;
      }
    }
  }
  return false;
};
