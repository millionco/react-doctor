import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "../../../utils/function-returns-matching-expression.js";
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

export interface OwnedLifecycleResourceAnalysis {
  accessPath: OwnedLifecycleResourcePath;
  allocation: EsTreeNode;
  creationKind: "effect" | "reactive" | "render" | "stable";
  hasUnknownOwnershipTransfer: boolean;
  ownerFunction: EsTreeNode;
  resourceSymbols: ReadonlySet<SymbolDescriptor>;
  symbols: ReadonlySet<SymbolDescriptor>;
}

export interface OwnedLifecycleCleanupAnalysis {
  isProven: boolean;
  isUnknown: boolean;
}

const getProgram = (node: EsTreeNode): EsTreeNodeOfType<"Program"> | null => {
  let current: EsTreeNode | null = node;
  while (current?.parent) current = current.parent;
  return isNodeOfType(current, "Program") ? current : null;
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

const findEffectCallForCallback = (
  callback: EsTreeNode,
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let matchingEffect: EsTreeNodeOfType<"CallExpression"> | null = null;
  walkAst(program, (candidate) => {
    if (
      !matchingEffect &&
      isNodeOfType(candidate, "CallExpression") &&
      isR3fReactApiCall(candidate, EFFECT_HOOK_NAMES, scopes) &&
      getEffectCallback(candidate, scopes) === callback
    ) {
      matchingEffect = candidate;
    }
  });
  return matchingEffect;
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
    if (symbol && [...resourceSymbols].some((resourceSymbol) => resourceSymbol.id === symbol.id)) {
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
  if (!symbol || ![...symbols].some((ownedSymbol) => ownedSymbol.id === symbol.id)) return false;
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
  return Boolean(
    symbol && [...analysis.symbols].some((ownedSymbol) => ownedSymbol.id === symbol.id),
  );
};

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
        if (!methodName || !borrowedArgumentMethodNames.has(methodName)) return true;
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
  borrowedArgumentMethodNames: ReadonlySet<string> = new Set(),
  retainsOwnershipInJsx = false,
): OwnedLifecycleResourceAnalysis | null => {
  const program = getProgram(allocation);
  if (!program) return null;
  const wrappedBinding = getWrappedBinding(allocation, context.scopes);
  let accessPath: OwnedLifecycleResourcePath;
  let creationKind: OwnedLifecycleResourceAnalysis["creationKind"];
  let ownerFunction: EsTreeNode | null;
  let sourceSymbol: SymbolDescriptor | null;
  if (wrappedBinding) {
    accessPath = wrappedBinding.accessPath;
    creationKind = wrappedBinding.creationKind;
    ownerFunction = wrappedBinding.ownerFunction;
    sourceSymbol = wrappedBinding.symbol;
  } else {
    accessPath = { kind: "direct", index: null, propertyName: null };
    sourceSymbol = getDirectBindingSymbol(allocation, context.scopes);
    if (!sourceSymbol) return null;
    const allocationFunction = findEnclosingFunction(allocation);
    if (!allocationFunction || isNodeConditionallyExecuted(allocation, allocationFunction)) {
      return null;
    }
    const effectCall = findEffectCallForCallback(allocationFunction, program, context.scopes);
    if (effectCall) {
      ownerFunction = findRenderPhaseComponentOrHook(effectCall, context.scopes);
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
  if (!ownerFunction || sourceSymbol.scope.kind === "module") return null;
  const symbols = collectAliasSymbols(sourceSymbol, context.scopes);
  const resourceSymbols = collectStructuredResourceSymbols(symbols, accessPath, context.scopes);
  return {
    accessPath,
    allocation,
    creationKind,
    hasUnknownOwnershipTransfer: hasUnknownOwnershipTransfer(
      symbols,
      resourceSymbols,
      accessPath,
      ownerFunction,
      context.scopes,
      borrowedArgumentMethodNames,
      retainsOwnershipInJsx,
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
  walkAst(program, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isR3fReactApiCall(candidate, EFFECT_HOOK_NAMES, context.scopes)
    ) {
      return;
    }
    const callback = getEffectCallback(candidate, context.scopes);
    if (!callback) return;
    if (analysis.creationKind === "effect") {
      if (findEnclosingFunction(analysis.allocation) !== callback) return;
    } else if (
      findRenderPhaseComponentOrHook(candidate, context.scopes) !== analysis.ownerFunction
    ) {
      return;
    }
    sources.push({
      callback,
      dependencyStatus: getDependencyStatus(candidate, analysis, context.scopes),
    });
  });
  sources.push({ callback: analysis.ownerFunction, dependencyStatus: "valid" });
  return sources;
};

export const analyzeOwnedLifecycleCleanup = (
  analysis: OwnedLifecycleResourceAnalysis,
  context: RuleContext,
  matchesCleanupFunction: (cleanupFunction: EsTreeNode) => boolean,
): OwnedLifecycleCleanupAnalysis => {
  const returnedExpressionContainsMatchingCleanup = (returnedExpression: EsTreeNode): boolean => {
    const cleanupFunction = resolveExactLocalFunction(returnedExpression, context.scopes);
    if (cleanupFunction) return matchesCleanupFunction(cleanupFunction);
    const candidate = stripParenExpression(returnedExpression);
    if (isNodeOfType(candidate, "ArrayExpression")) {
      return candidate.elements.some(
        (element) =>
          element &&
          !isNodeOfType(element, "SpreadElement") &&
          returnedExpressionContainsMatchingCleanup(element),
      );
    }
    if (isNodeOfType(candidate, "ObjectExpression")) {
      return candidate.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          returnedExpressionContainsMatchingCleanup(property.value),
      );
    }
    return false;
  };
  let isUnknown = false;
  for (const source of collectLifecycleCleanupSources(analysis, context)) {
    const doesReturnMatchingCleanup = functionReturnsMatchingExpression(
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

export const functionInvokesOwnedResourceMethod = (
  functionNode: EsTreeNode,
  analysis: OwnedLifecycleResourceAnalysis,
  methodName: string,
  scopes: ScopeAnalysis,
  matchesCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean = () => true,
): boolean => {
  let didInvokeMethod = false;
  walkFunctionExecution(functionNode, scopes, (candidate) => {
    if (
      didInvokeMethod ||
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
