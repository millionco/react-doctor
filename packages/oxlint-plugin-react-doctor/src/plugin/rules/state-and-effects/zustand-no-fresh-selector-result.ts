import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionReturnsCollectionAtPath } from "../../utils/function-returns-collection-at-path.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveFreshRenderValue } from "../../utils/resolve-fresh-render-value.js";
import {
  resolveZustandApiBinding,
  resolveZustandStoreCreator,
  resolveZustandStoreFactoryCall,
  type ZustandStoreCreator,
} from "../../utils/resolve-zustand-api.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

interface FreshSelectorResult {
  readonly kind: "array" | "function" | "instance" | "object";
  readonly node: EsTreeNode;
}

interface ZustandBoundStore {
  readonly creatorFunction: ZustandStoreCreator["creatorFunction"] | null;
  readonly hasDefaultEquality: boolean;
  readonly supportsEqualityArgument: boolean;
}

interface ZustandSelectorCall {
  readonly selector: EsTreeNode;
  readonly storeCreatorFunction: ZustandStoreCreator["creatorFunction"] | null;
}

interface FreshSelectorAnalysis {
  readonly scopes: ScopeAnalysis;
  readonly selectorFunction: EsTreeNode;
  readonly storeCreatorFunction: ZustandStoreCreator["creatorFunction"] | null;
}

const ALLOCATING_ARRAY_METHODS = new Set([
  "filter",
  "flat",
  "flatMap",
  "map",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const SAME_REFERENCE_ARRAY_METHODS = new Set(["reverse", "sort"]);

const ALLOCATING_NAMESPACE_METHOD_KINDS = new Map<
  string,
  ReadonlyMap<string, FreshSelectorResult["kind"]>
>([
  [
    "Array",
    new Map([
      ["from", "array"],
      ["of", "array"],
    ]),
  ],
  [
    "Object",
    new Map([
      ["create", "object"],
      ["entries", "array"],
      ["fromEntries", "object"],
      ["keys", "array"],
      ["values", "array"],
    ]),
  ],
]);

const isNullishEqualityArgument = (argument: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(argument);
  return (
    (isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      scopes.isGlobalReference(candidate)) ||
    (isNodeOfType(candidate, "Literal") && candidate.value === null) ||
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void")
  );
};

const hasExplicitEqualityArgument = (
  argumentsList: ReadonlyArray<EsTreeNode>,
  equalityArgumentIndex: number,
  scopes: ScopeAnalysis,
): boolean => {
  const equalityArgument = argumentsList[equalityArgumentIndex];
  if (!equalityArgument) return false;
  if (isNodeOfType(equalityArgument, "SpreadElement")) return true;
  return !isNullishEqualityArgument(equalityArgument, scopes);
};

const resolveZustandStoreCreation = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ZustandBoundStore | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "CallExpression")) return null;
  const factoryCall = resolveZustandStoreFactoryCall(candidate, scopes);
  if (
    !factoryCall ||
    (factoryCall.factoryApiName !== "create" &&
      factoryCall.factoryApiName !== "createWithEqualityFn")
  ) {
    return null;
  }
  const creator = resolveZustandStoreCreator(candidate, scopes);
  return {
    creatorFunction: creator?.creatorFunction ?? null,
    hasDefaultEquality:
      factoryCall.factoryApiName === "createWithEqualityFn" &&
      hasExplicitEqualityArgument(candidate.arguments, 1, scopes),
    supportsEqualityArgument: factoryCall.factoryApiName === "createWithEqualityFn",
  };
};

const resolveZustandBoundStore = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): ZustandBoundStore | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return (
    resolveZustandStoreCreation(symbol.initializer, scopes) ??
    resolveZustandBoundStore(symbol.initializer, scopes, visitedSymbolIds)
  );
};

const getZustandSelectorCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): ZustandSelectorCall | null => {
  const apiBinding = resolveZustandApiBinding(callExpression.callee, scopes);
  if (apiBinding?.apiName === "useStore" || apiBinding?.apiName === "useStoreWithEqualityFn") {
    const selector = callExpression.arguments[1];
    if (!selector || isNodeOfType(selector, "SpreadElement")) return null;
    if (
      apiBinding.apiName === "useStoreWithEqualityFn" &&
      hasExplicitEqualityArgument(callExpression.arguments, 2, scopes)
    ) {
      return null;
    }
    return { selector, storeCreatorFunction: null };
  }

  const boundStore = resolveZustandBoundStore(callExpression.callee, scopes);
  const selector = callExpression.arguments[0];
  if (!boundStore || !selector || isNodeOfType(selector, "SpreadElement")) return null;
  if (
    boundStore.hasDefaultEquality ||
    (boundStore.supportsEqualityArgument &&
      hasExplicitEqualityArgument(callExpression.arguments, 1, scopes))
  ) {
    return null;
  }
  return { selector, storeCreatorFunction: boundStore.creatorFunction };
};

const isUseShallowCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => resolveZustandApiBinding(callExpression.callee, scopes)?.apiName === "useShallow";

const resolveSelectorFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isFunctionLike(candidate)) return candidate;

  if (isNodeOfType(candidate, "CallExpression")) {
    if (isUseShallowCall(candidate, scopes)) return null;
    if (
      !isReactApiCall(candidate, "useCallback", scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      return null;
    }
    const callback = candidate.arguments[0];
    if (!callback || isNodeOfType(callback, "SpreadElement")) return null;
    return resolveSelectorFunction(callback, scopes, visitedSymbolIds);
  }

  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode)) {
    return symbol.declarationNode;
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  visitedSymbolIds.add(symbol.id);
  return resolveSelectorFunction(symbol.initializer, scopes, visitedSymbolIds);
};

const selectorStatePropertyPath = (
  expression: EsTreeNode,
  analysis: FreshSelectorAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): string[] | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = analysis.scopes.symbolFor(candidate);
    const selectorParameter = isFunctionLike(analysis.selectorFunction)
      ? analysis.selectorFunction.params[0]
      : null;
    if (
      selectorParameter &&
      isNodeOfType(selectorParameter, "Identifier") &&
      symbol?.id === analysis.scopes.symbolFor(selectorParameter)?.id
    ) {
      return [];
    }
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return selectorStatePropertyPath(symbol.initializer, analysis, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(candidate);
  const objectPath = selectorStatePropertyPath(candidate.object, analysis, visitedSymbolIds);
  return propertyName && objectPath ? [...objectPath, propertyName] : null;
};

const freshResultFromAllocatingCall = (
  expression: EsTreeNodeOfType<"CallExpression">,
  analysis: FreshSelectorAnalysis,
  visitedSymbolIds: Set<number>,
): FreshSelectorResult | null => {
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (!methodName) return null;
  const receiver = stripParenExpression(callee.object);

  if (isNodeOfType(receiver, "Identifier") && analysis.scopes.isGlobalReference(receiver)) {
    const resultKind = ALLOCATING_NAMESPACE_METHOD_KINDS.get(receiver.name)?.get(methodName);
    if (resultKind) return { kind: resultKind, node: expression };
    if (receiver.name === "Object" && methodName === "assign") {
      const target = expression.arguments[0];
      if (!target || isNodeOfType(target, "SpreadElement")) return null;
      const freshTarget = resolveFreshSelectorResult(target, analysis, new Set(visitedSymbolIds));
      return freshTarget ? { kind: freshTarget.kind, node: expression } : null;
    }
  }

  if (ALLOCATING_ARRAY_METHODS.has(methodName)) {
    const freshReceiver = resolveFreshSelectorResult(receiver, analysis, new Set(visitedSymbolIds));
    if (freshReceiver?.kind === "array") return { kind: "array", node: expression };
    const receiverPath = selectorStatePropertyPath(receiver, analysis);
    if (
      receiverPath &&
      analysis.storeCreatorFunction &&
      functionReturnsCollectionAtPath({
        collectionKind: "array",
        functionNode: analysis.storeCreatorFunction,
        propertyPath: receiverPath,
        scopes: analysis.scopes,
      })
    ) {
      return { kind: "array", node: expression };
    }
    return null;
  }
  if (!SAME_REFERENCE_ARRAY_METHODS.has(methodName)) return null;
  const freshReceiver = resolveFreshSelectorResult(receiver, analysis, new Set(visitedSymbolIds));
  return freshReceiver ? { kind: "array", node: expression } : null;
};

const resolveFreshSelectorResult = (
  expression: EsTreeNode,
  analysis: FreshSelectorAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): FreshSelectorResult | null => {
  const freshRenderValue = resolveFreshRenderValue(expression, analysis.scopes);
  if (
    freshRenderValue?.kind === "array" ||
    freshRenderValue?.kind === "function" ||
    freshRenderValue?.kind === "instance" ||
    freshRenderValue?.kind === "object"
  ) {
    return { kind: freshRenderValue.kind, node: expression };
  }

  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "CallExpression")) {
    return freshResultFromAllocatingCall(candidate, analysis, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      resolveFreshSelectorResult(candidate.consequent, analysis, new Set(visitedSymbolIds)) ??
      resolveFreshSelectorResult(candidate.alternate, analysis, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    if (candidate.operator === "&&") {
      return resolveFreshSelectorResult(candidate.right, analysis, visitedSymbolIds);
    }
    return (
      resolveFreshSelectorResult(candidate.left, analysis, new Set(visitedSymbolIds)) ??
      resolveFreshSelectorResult(candidate.right, analysis, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const returnedExpression = candidate.expressions[candidate.expressions.length - 1];
    return returnedExpression
      ? resolveFreshSelectorResult(returnedExpression, analysis, visitedSymbolIds)
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;

  const symbol = analysis.scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    symbol.scope.kind === "module" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveFreshSelectorResult(symbol.initializer, analysis, visitedSymbolIds);
};

const findFreshSelectorReturn = (
  selectorFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  storeCreatorFunction: ZustandStoreCreator["creatorFunction"] | null,
): FreshSelectorResult | null => {
  if (!isFunctionLike(selectorFunction) || !selectorFunction.body) return null;
  const analysis: FreshSelectorAnalysis = {
    scopes,
    selectorFunction,
    storeCreatorFunction,
  };
  if (!isNodeOfType(selectorFunction.body, "BlockStatement")) {
    return resolveFreshSelectorResult(selectorFunction.body, analysis);
  }

  let freshResult: FreshSelectorResult | null = null;
  walkAst(selectorFunction.body, (candidate) => {
    if (freshResult) return false;
    if (candidate !== selectorFunction.body && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "ReturnStatement") || !candidate.argument) return;
    freshResult = resolveFreshSelectorResult(candidate.argument, analysis);
    return freshResult ? false : undefined;
  });
  return freshResult;
};

export const zustandNoFreshSelectorResult = defineRule({
  id: "zustand-no-fresh-selector-result",
  title: "Zustand selector returns a fresh value",
  severity: "error",
  category: "Performance",
  requires: ["zustand", "zustand:5"],
  recommendation:
    "Select a stable store field, split the selector, or wrap a collection selector with `useShallow`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const selectorCall = getZustandSelectorCall(node, context.scopes);
      if (!selectorCall) return;
      const selectorFunction = resolveSelectorFunction(selectorCall.selector, context.scopes);
      if (!selectorFunction) return;
      const freshResult = findFreshSelectorReturn(
        selectorFunction,
        context.scopes,
        selectorCall.storeCreatorFunction,
      );
      if (!freshResult) return;

      context.report({
        node: freshResult.node,
        message:
          "This Zustand selector creates a new reference whenever the store is read, so Object.is never sees a stable snapshot and Zustand v5 can repeatedly render or hit maximum update depth. Select a stable field or use `useShallow`.",
      });
    },
  }),
});
